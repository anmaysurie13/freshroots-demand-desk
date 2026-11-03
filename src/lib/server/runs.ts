import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decideAll } from "../ai/decide";
import { providerFromEnv } from "../ai/providers";
import { RULES_VERSION, rulesConfig, type RulesConfig } from "../config";
import { runRuleEngine } from "../engine/rules";
import { SAMPLE_FILES } from "../sample-data";
import { FILE_KEYS, validateFiles, type FileKey, type ValidationReport } from "../validation/validate";
import { HttpError, type SessionUser } from "./auth";
import { audit } from "./audit";
import { automationStopped } from "./kill";

export type UploadedFiles = Partial<Record<FileKey, string>>;
const MASTER_KEYS: FileKey[] = ["sku", "distributor", "calendar"];

export const STOP_MESSAGE = "Automation stopped. New runs and the AI step are blocked until a kill switch is re-armed.";

/** Fill the three master files from the most recent snapshot when the planner chose "use previous master files". */
export async function withPreviousMasters(files: UploadedFiles, usePrevious: boolean): Promise<UploadedFiles> {
  if (!usePrevious) return files;
  const [last] = await getDb().select({ rawFiles: schema.dataSnapshots.rawFiles }).from(schema.dataSnapshots).orderBy(desc(schema.dataSnapshots.id)).limit(1);
  if (!last) throw new HttpError(400, "There is no earlier upload to take master files from.");
  const merged = { ...files };
  for (const k of MASTER_KEYS) if (!merged[k]) merged[k] = last.rawFiles[k];
  return merged;
}

export function sampleFiles(): UploadedFiles {
  return { ...SAMPLE_FILES };
}

export function validateUpload(files: UploadedFiles, isSample: boolean): ValidationReport {
  return validateFiles(files, { now: new Date(), skipAgeCheck: isSample }, rulesConfig);
}

export type CreateRunResult =
  | { ok: false; report: ValidationReport; needsAck: boolean }
  | { ok: true; runId: number; flagged: number; report: ValidationReport };

export async function createRun(opts: { files: UploadedFiles; user: SessionUser; isSample: boolean; ackWarnings: boolean }): Promise<CreateRunResult> {
  const db = getDb();
  const stop = await automationStopped(db);
  if (stop.stopped) throw new HttpError(409, STOP_MESSAGE);

  // Validation is repeated on the server so the client can never skip it.
  const report = validateUpload(opts.files, opts.isSample);
  if (report.errors.length || !report.parsed) return { ok: false, report, needsAck: false };
  if (report.warnings.length && !opts.ackWarnings) return { ok: false, report, needsAck: true };

  const p = report.parsed;
  const out = runRuleEngine(
    { asOfDate: p.asOfDate, skus: p.skus, sales: p.sales, inventory: p.inventory, isFestival: p.isFestival },
    rulesConfig,
  );

  const runId = await db.transaction(async (tx) => {
    const raw = Object.fromEntries(FILE_KEYS.map((k) => [k, opts.files[k] ?? ""]));
    const [snap] = await tx
      .insert(schema.dataSnapshots)
      .values({
        uploadedBy: opts.user.id,
        asOfDate: p.asOfDate,
        isSample: opts.isSample,
        rawFiles: raw,
        validationReport: { errors: report.errors, warnings: report.warnings, rowCounts: report.rowCounts },
      })
      .returning({ id: schema.dataSnapshots.id });

    const [run] = await tx
      .insert(schema.runs)
      .values({
        snapshotId: snap.id,
        createdBy: opts.user.id,
        rulesVersion: RULES_VERSION,
        rulesJson: rulesConfig,
        asOfDate: p.asOfDate,
        lastCompleteWeek: out.lastCompleteWeek,
        isFestival: p.isFestival,
        status: out.flags.length ? "flagged" : "completed",
        evaluatedSkus: out.evaluated,
        skippedJson: out.skipped,
        completedAt: out.flags.length ? null : new Date(),
      })
      .returning({ id: schema.runs.id });

    if (out.flags.length) {
      await tx.insert(schema.flags).values(
        out.flags.map((f) => ({
          runId: run.id,
          skuId: f.skuId,
          skuName: f.skuName,
          category: f.category,
          perishability: f.perishability,
          uom: f.uom,
          distributorId: f.distributorId,
          standardQty: f.standardQty,
          flagTypes: f.flagTypes,
          avgWeeklySales: String(f.avgWeeklySales),
          recentAvg: String(f.recentAvg),
          demandRatio: String(f.demandRatio),
          uplift: String(f.uplift),
          demandRate: String(f.demandRate),
          unitsOnHand: f.unitsOnHand,
          coverWeeks: f.coverWeeks === null ? null : String(f.coverWeeks),
          minCover: String(f.minCover),
          maxCover: String(f.maxCover),
          ruleAction: f.ruleAction,
          ruleQty: f.ruleQty,
          needsJudgment: f.needsJudgment,
          judgmentReasons: f.judgmentReasons,
        })),
      );
    }
    await audit(tx, {
      actor: opts.user,
      action: "run.created",
      entity: "runs",
      entityId: run.id,
      after: {
        snapshotId: snap.id,
        sample: opts.isSample,
        asOfDate: p.asOfDate,
        rulesVersion: RULES_VERSION,
        evaluated: out.evaluated,
        flagged: out.flags.length,
        warningsAcknowledged: report.warnings.length,
      },
    });
    return run.id;
  });
  return { ok: true, runId, flagged: out.flags.length, report };
}

export interface AiStepSummary {
  total: number;
  valid: number;
  fallback: number;
  fallbackPct: number;
  warnHighFallback: boolean;
  provider: string;
  model: string;
}

/** Runs the AI step for a run that is waiting for it. Claims the run atomically so it cannot run twice. */
export async function runAiStep(runId: number, user: SessionUser): Promise<AiStepSummary> {
  const db = getDb();
  const stop = await automationStopped(db);
  if (stop.stopped) throw new HttpError(409, STOP_MESSAGE);

  const claimed = await db
    .update(schema.runs)
    .set({ status: "ai_running", aiStartedAt: new Date() })
    .where(sql`${schema.runs.id} = ${runId} and ${schema.runs.status} = 'flagged'`)
    .returning();
  if (!claimed.length) throw new HttpError(409, "This run is not waiting for the AI step.");
  const run = claimed[0];

  try {
    const [snap] = await db.select().from(schema.dataSnapshots).where(eq(schema.dataSnapshots.id, run.snapshotId));
    const cfg = run.rulesJson as RulesConfig;
    const report = validateFiles(snap.rawFiles, { now: new Date(), skipAgeCheck: true }, cfg);
    if (!report.parsed) throw new Error("Stored snapshot no longer parses.");
    const p = report.parsed;
    // The engine is deterministic, so recomputing from the stored snapshot and stored rules reproduces the stored flags.
    const out = runRuleEngine({ asOfDate: p.asOfDate, skus: p.skus, sales: p.sales, inventory: p.inventory, isFestival: p.isFestival }, cfg);
    const flagRows = await db.select().from(schema.flags).where(eq(schema.flags.runId, runId));
    const idBySku = new Map(flagRows.map((f) => [f.skuId, f.id]));

    const provider = providerFromEnv();
    const records = await decideAll(out.flags, {
      provider,
      cfg,
      runDate: p.asOfDate,
      isFestival: p.isFestival,
      allNames: p.skus.map((s) => s.name),
      deadline: Date.now() + cfg.ai.stepBudgetSeconds * 1000,
      onLog: (l) => console.log(`[ai run ${runId}] ${l}`),
    });

    const stoppedNow = (await automationStopped(db)).stopped;
    await db.transaction(async (tx) => {
      await tx.insert(schema.aiDecisions).values(
        records.map((r) => ({
          flagId: idBySku.get(r.skuId)!,
          runId,
          status: stoppedNow ? "voided_by_kill" : "pending_review",
          provider: r.provider,
          model: r.model,
          promptVersion: r.promptVersion,
          action: r.action,
          quantity: r.quantity,
          explanation: r.explanation,
          confidence: r.confidence,
          needsJudgment: r.needsJudgment,
          judgmentNote: r.judgmentNote,
          valid: r.valid,
          invalidReasons: r.invalidReasons,
          isFallback: r.isFallback,
          inputJson: r.inputJson,
          rawResponse: r.rawResponse,
          latencyMs: r.latencyMs,
          attempts: r.attempts,
        })),
      );
      await tx
        .update(schema.runs)
        .set({ status: stoppedNow ? "blocked" : "in_review", aiFinishedAt: new Date() })
        .where(eq(schema.runs.id, runId));
      await audit(tx, {
        actor: user,
        action: "run.ai_done",
        entity: "runs",
        entityId: runId,
        after: {
          decisions: records.length,
          fallback: records.filter((r) => r.isFallback).length,
          model: provider?.model ?? "none",
          promptVersion: records[0]?.promptVersion,
        },
      });
    });

    const fallback = records.filter((r) => r.isFallback).length;
    const pct = records.length ? (fallback / records.length) * 100 : 0;
    return {
      total: records.length,
      valid: records.length - fallback,
      fallback,
      fallbackPct: pct,
      warnHighFallback: pct > cfg.ai.fallbackWarningPct,
      provider: provider?.name ?? "none",
      model: provider?.model ?? "none",
    };
  } catch (e) {
    // Put the run back so the planner can retry the AI step instead of leaving it stuck.
    await db.update(schema.runs).set({ status: "flagged" }).where(eq(schema.runs.id, runId));
    console.error(`[ai run ${runId}] failed:`, e instanceof Error ? e.message : "unknown");
    throw new HttpError(500, "The AI step failed. Nothing was saved. You can start it again.");
  }
}

export async function listRuns(limit = 20) {
  return getDb().select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(limit);
}

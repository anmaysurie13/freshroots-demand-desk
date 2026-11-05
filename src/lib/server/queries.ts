import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { rulesConfig } from "../config";
import { daysBetween, parseDate } from "../engine/weeks";
import { evaluateKill2, quarterBounds } from "../kill/logic";
import { getKillRow, kill1Counts, quarterLoss, todayIst } from "./kill";

// ---------------------------------------------------------------- review page

const FLAG_ORDER: Record<string, number> = { STOCKOUT_RISK: 0, HIGH_DEMAND: 1, OVERSTOCK_RISK: 2 };

export interface ReviewItem {
  decisionId: number;
  flagId: number;
  skuId: string;
  skuName: string;
  category: string;
  perishability: string;
  flagTypes: string[];
  coverWeeks: number | null;
  minCover: number;
  maxCover: number;
  unitsOnHand: number;
  demandRatio: number;
  uom: string;
  ruleAction: string;
  ruleQty: number;
  aiAction: string;
  aiQty: number;
  explanation: string;
  confidence: string | null;
  needsJudgment: boolean;
  judgmentNote: string | null;
  judgmentReasons: { code: string; text: string }[];
  isFallback: boolean;
  invalidReasons: string[];
  status: string;
  review: null | {
    outcome: string;
    finalAction: string;
    finalQty: number;
    finalFlagTypes: string[];
    reasonCode: string | null;
    reasonText: string | null;
    reviewedAt: Date;
    reviewerName: string;
    breakGlass: boolean;
  };
}

function itemRank(i: ReviewItem): [number, number, string] {
  const worst = Math.min(...i.flagTypes.map((f) => FLAG_ORDER[f] ?? 9));
  return [i.needsJudgment ? 0 : 1, worst, i.skuId];
}

export async function getReviewRun(runId?: number) {
  const db = getDb();
  let run;
  if (runId) {
    [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  } else {
    [run] = await db
      .select()
      .from(schema.runs)
      .where(inArray(schema.runs.status, ["flagged", "ai_running", "in_review"]))
      .orderBy(desc(schema.runs.id))
      .limit(1);
    if (!run) [run] = await db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(1);
  }
  if (!run) return null;

  const rows = await db
    .select({ f: schema.flags, d: schema.aiDecisions, r: schema.reviews, reviewer: schema.users.name })
    .from(schema.flags)
    .leftJoin(schema.aiDecisions, eq(schema.aiDecisions.flagId, schema.flags.id))
    .leftJoin(schema.reviews, eq(schema.reviews.aiDecisionId, schema.aiDecisions.id))
    .leftJoin(schema.users, eq(schema.users.id, schema.reviews.reviewerId))
    .where(eq(schema.flags.runId, run.id));

  const items: ReviewItem[] = rows
    .filter((x) => x.d)
    .map(({ f, d, r, reviewer }) => ({
      decisionId: d!.id,
      flagId: f.id,
      skuId: f.skuId,
      skuName: f.skuName,
      category: f.category,
      perishability: f.perishability,
      flagTypes: f.flagTypes,
      coverWeeks: f.coverWeeks === null ? null : Number(f.coverWeeks),
      minCover: Number(f.minCover),
      maxCover: Number(f.maxCover),
      unitsOnHand: f.unitsOnHand,
      demandRatio: Number(f.demandRatio),
      uom: f.uom,
      ruleAction: f.ruleAction,
      ruleQty: f.ruleQty,
      aiAction: d!.action,
      aiQty: d!.quantity,
      explanation: d!.explanation,
      confidence: d!.confidence,
      needsJudgment: d!.needsJudgment,
      judgmentNote: d!.judgmentNote,
      judgmentReasons: f.judgmentReasons,
      isFallback: d!.isFallback,
      invalidReasons: d!.invalidReasons,
      status: d!.status,
      review: r
        ? {
            outcome: r.outcome,
            finalAction: r.finalAction,
            finalQty: r.finalQty,
            finalFlagTypes: r.finalFlagTypes,
            reasonCode: r.reasonCode,
            reasonText: r.reasonText,
            reviewedAt: r.reviewedAt,
            reviewerName: reviewer ?? "",
            breakGlass: r.breakGlass,
          }
        : null,
    }));

  items.sort((a, b) => {
    const [a0, a1, a2] = itemRank(a);
    const [b0, b1, b2] = itemRank(b);
    return a0 - b0 || a1 - b1 || a2.localeCompare(b2);
  });

  const flagCount = rows.length;
  const reviewed = items.filter((i) => i.review).length;
  const accepted = items.filter((i) => i.review?.outcome === "accepted").length;
  const rejected = items.filter((i) => i.review?.outcome === "rejected").length;
  const voided = items.filter((i) => i.status === "voided_by_kill").length;
  const fallback = items.filter((i) => i.isFallback).length;
  const [snap] = await db.select({ isSample: schema.dataSnapshots.isSample }).from(schema.dataSnapshots).where(eq(schema.dataSnapshots.id, run.snapshotId));

  return {
    run,
    isSample: snap?.isSample ?? false,
    items,
    counts: { flags: flagCount, decided: items.length, reviewed, accepted, rejected, voided, fallback, pending: items.length - reviewed - voided },
    fallbackPct: items.length ? (fallback / items.length) * 100 : 0,
    skipped: run.skippedJson as { skuId: string; skuName: string; reason: string }[],
  };
}

// ------------------------------------------------------------------ dashboard

export async function getDashboard() {
  const db = getDb();
  const today = todayIst();
  const k = await getKillRow(db);
  const kill1 = await kill1Counts(db, k.kill1EpochStart);
  const ql = await quarterLoss(db, today);
  const q = quarterBounds(today);

  // Loss entries in this quarter, oldest first, for the loss chart.
  const lossRows = await db
    .select()
    .from(schema.lossEntries)
    .where(and(gte(schema.lossEntries.periodStart, q.start), sql`${schema.lossEntries.periodStart} <= ${q.end}`))
    .orderBy(asc(schema.lossEntries.periodStart));
  const lossSeries = lossRows.map((l) => ({
    label: l.periodStart === l.periodEnd ? l.periodStart : `${l.periodStart} to ${l.periodEnd}`,
    stockout: Number(l.stockoutLoss),
    overstock: Number(l.overstockWriteoff),
  }));

  // Reversal rate over time: cumulative, counted the same way Kill 1 counts (non-fallback, since the epoch).
  const revRows = await db
    .select({ at: schema.reviews.reviewedAt, rev: schema.reviews.isReversal })
    .from(schema.reviews)
    .innerJoin(schema.aiDecisions, eq(schema.aiDecisions.id, schema.reviews.aiDecisionId))
    .where(and(eq(schema.aiDecisions.isFallback, false), gte(schema.reviews.reviewedAt, k.kill1EpochStart)))
    .orderBy(asc(schema.reviews.reviewedAt), asc(schema.reviews.id));
  let rv = 0;
  const reversalSeries = revRows.map((r, i) => {
    if (r.rev) rv++;
    return { n: i + 1, ratePct: (rv / (i + 1)) * 100, at: r.at };
  });

  const reasonRows = await db
    .select({ code: schema.reviews.reasonCode, n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.outcome, "rejected"), isNotNull(schema.reviews.reasonCode)))
    .groupBy(schema.reviews.reasonCode);

  // Runs, with counts.
  const runs = await db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(15);
  const ids = runs.map((r) => r.id);
  const flagRows = ids.length ? await db.select({ runId: schema.flags.runId, types: schema.flags.flagTypes }).from(schema.flags).where(inArray(schema.flags.runId, ids)) : [];
  const decRows = ids.length
    ? await db
        .select({ runId: schema.aiDecisions.runId, fallback: schema.aiDecisions.isFallback, nj: schema.aiDecisions.needsJudgment, outcome: schema.reviews.outcome, at: schema.reviews.reviewedAt })
        .from(schema.aiDecisions)
        .leftJoin(schema.reviews, eq(schema.reviews.aiDecisionId, schema.aiDecisions.id))
        .where(inArray(schema.aiDecisions.runId, ids))
    : [];

  const runHistory = runs.map((r) => {
    const f = flagRows.filter((x) => x.runId === r.id);
    const d = decRows.filter((x) => x.runId === r.id);
    const lastReview = d.reduce<Date | null>((m, x) => (x.at && (!m || x.at > m) ? x.at : m), null);
    return {
      id: r.id,
      createdAt: r.createdAt,
      asOfDate: r.asOfDate,
      status: r.status,
      flags: f.length,
      accepted: d.filter((x) => x.outcome === "accepted").length,
      rejected: d.filter((x) => x.outcome === "rejected").length,
      fallback: d.filter((x) => x.fallback).length,
      turnaroundHours: r.status === "completed" && lastReview ? (lastReview.getTime() - r.createdAt.getTime()) / 3_600_000 : null,
    };
  });

  const flagTypeCounts = runs
    .slice(0, 8)
    .reverse()
    .map((r) => {
      const f = flagRows.filter((x) => x.runId === r.id);
      const c = (t: string) => f.filter((x) => x.types.includes(t)).length;
      return { label: `#${r.id}`, high: c("HIGH_DEMAND"), stockout: c("STOCKOUT_RISK"), overstock: c("OVERSTOCK_RISK") };
    });

  // Workflow and quality metrics.
  const [allDec] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      fallback: sql<number>`count(*) filter (where ${schema.aiDecisions.isFallback})`.mapWith(Number),
      nj: sql<number>`count(*) filter (where ${schema.aiDecisions.needsJudgment})`.mapWith(Number),
    })
    .from(schema.aiDecisions);

  // Box #9 of the component map: AI flags issued and reversed, cumulative since go-live (fallbacks are rule-engine, not AI).
  const [rev] = await db
    .select({
      reviewed: sql<number>`count(*)`.mapWith(Number),
      reversed: sql<number>`count(*) filter (where ${schema.reviews.isReversal})`.mapWith(Number),
    })
    .from(schema.aiDecisions)
    .innerJoin(schema.reviews, eq(schema.reviews.aiDecisionId, schema.aiDecisions.id))
    .where(eq(schema.aiDecisions.isFallback, false));

  const placed = await db
    .select({ placedAt: schema.buyingDecisions.placedAt, createdAt: schema.buyingDecisions.createdAt, asOf: schema.runs.asOfDate })
    .from(schema.buyingDecisions)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.buyingDecisions.runId))
    .where(eq(schema.buyingDecisions.status, "placed"));
  const ages = placed.filter((p) => p.placedAt && parseDate(p.asOf)).map((p) => daysBetween(parseDate(p.asOf)!, parseDate(p.placedAt!.toISOString().slice(0, 10))!));
  const lags = placed.filter((p) => p.placedAt).map((p) => (p.placedAt!.getTime() - p.createdAt.getTime()) / 3_600_000);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const monthStart = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1));
  const [{ monthRuns }] = await db
    .select({ monthRuns: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.runs)
    .where(and(eq(schema.runs.status, "completed"), gte(schema.runs.completedAt, monthStart)));

  const turnarounds = runHistory.filter((r) => r.turnaroundHours !== null).map((r) => r.turnaroundHours!);

  const [lastAlert] = await db
    .select()
    .from(schema.killEvents)
    .where(and(eq(schema.killEvents.switch, 2), eq(schema.killEvents.event, "alert")))
    .orderBy(desc(schema.killEvents.id))
    .limit(1);

  return {
    today,
    kill: { state: k, kill1, kill2State: k.kill2State },
    quarter: { ...ql, state: evaluateKill2(ql.total, rulesConfig), label: q.label },
    lossSeries,
    reversalSeries,
    reasons: reasonRows.map((r) => ({ code: r.code ?? "", n: r.n })),
    runHistory,
    flagTypeCounts,
    quality: {
      fallbackRatePct: allDec.total ? (allDec.fallback / allDec.total) * 100 : null,
      needsJudgmentPct: allDec.total ? (allDec.nj / allDec.total) * 100 : null,
      decisions: allDec.total,
      aiIssued: allDec.total - allDec.fallback,
      aiReviewed: rev.reviewed,
      aiReversed: rev.reversed,
    },
    workflow: {
      dataAgeDays: avg(ages),
      dataAgeLatest: ages.length ? ages[ages.length - 1] : null,
      orderLagHours: avg(lags),
      reviewTurnaroundHours: avg(turnarounds),
      runsThisMonth: monthRuns,
      placedCount: placed.length,
    },
    lastAlert: lastAlert ?? null,
  };
}

// ------------------------------------------------------------ audit, users, mail

export async function getAudit(filter: { action?: string; entity?: string; actor?: string; limit?: number }) {
  const conds = [];
  if (filter.action) conds.push(ilike(schema.auditLog.action, `%${filter.action}%`));
  if (filter.entity) conds.push(eq(schema.auditLog.entity, filter.entity));
  if (filter.actor) conds.push(ilike(schema.auditLog.actorLabel, `%${filter.actor}%`));
  return getDb()
    .select()
    .from(schema.auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.auditLog.id))
    .limit(filter.limit ?? 200);
}

export async function getUsersList() {
  return getDb()
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, createdAt: schema.users.createdAt })
    .from(schema.users)
    .orderBy(asc(schema.users.id));
}

export async function getOutbox(limit = 20) {
  return getDb().select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.id)).limit(limit);
}

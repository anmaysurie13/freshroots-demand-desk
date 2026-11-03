import type { RulesConfig } from "../config";
import type { FlagResult } from "../engine/types";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import type { AiInput, AiProvider, DecisionRecord } from "./types";
import { validateDecision } from "./validator";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function buildAiInput(flag: FlagResult, runDate: string, isFestival: boolean, cfg: RulesConfig): AiInput {
  const bounded = cfg.ai.deviationPolicy === "bounded" && flag.ruleAction === "REORDER";
  const pct = cfg.ai.boundedDeviationPct / 100;
  const limits = bounded
    ? { min: Math.max(0, Math.ceil(flag.ruleQty * (1 - pct) - 1e-9)), max: Math.floor(flag.ruleQty * (1 + pct) + 1e-9) }
    : { min: flag.ruleQty, max: flag.ruleQty };
  return {
    run_date: runDate,
    is_festival_month: isFestival,
    sku: {
      sku_id: flag.skuId,
      name: flag.skuName,
      category: flag.category,
      perishability: flag.perishability,
      standard_reorder_qty: flag.standardQty,
      unit: flag.uom,
    },
    metrics: {
      avg_weekly_sales: r2(flag.avgWeeklySales),
      recent_4wk_avg: r2(flag.recentAvg),
      demand_ratio: r4(flag.demandRatio),
      festival_uplift: flag.uplift,
      demand_rate: r2(flag.demandRate),
      units_on_hand: flag.unitsOnHand,
      cover_weeks: flag.coverWeeks === null ? null : r2(flag.coverWeeks),
      min_cover_weeks: flag.minCover,
      max_cover_weeks: flag.maxCover,
    },
    flags: flag.flagTypes,
    rule_engine: { action: flag.ruleAction, quantity: flag.ruleQty, multiplier: flag.multiplier },
    allowed_actions: [flag.ruleAction],
    quantity_limits: limits,
    needs_judgment_from_engine: flag.needsJudgment,
    judgment_reasons: flag.judgmentReasons.map((r) => r.text),
  };
}

/** Deterministic text built only from the rule engine's own numbers. */
export function fallbackExplanation(flag: FlagResult): string {
  const cover = flag.coverWeeks === null ? "unbounded" : `${r2(flag.coverWeeks)} weeks`;
  if (flag.ruleAction === "REORDER") {
    const why = flag.flagTypes.includes("HIGH_DEMAND")
      ? `Recent sales are ${r1((flag.demandRatio - 1) * 100)}% above the 12-week average and cover is ${cover}.`
      : `Cover is ${cover} against a minimum of ${flag.minCover} weeks.`;
    return `${why} Rule engine recommends reordering ${flag.ruleQty} units.`;
  }
  return `Cover is ${cover} against a maximum of ${flag.maxCover} weeks. Rule engine recommends pausing the next order.`;
}

function fallbackRecord(flag: FlagResult, input: AiInput, provider: AiProvider | null, why: string[], raw: string | null, ms: number, attempts: number): DecisionRecord {
  return {
    skuId: flag.skuId,
    provider: provider?.name ?? "none",
    model: provider?.model ?? "none",
    promptVersion: PROMPT_VERSION,
    action: flag.ruleAction,
    quantity: flag.ruleQty,
    explanation: fallbackExplanation(flag),
    confidence: null,
    needsJudgment: flag.needsJudgment,
    judgmentNote: flag.needsJudgment ? flag.judgmentReasons.map((r) => r.text).join(" ").slice(0, 200) : null,
    valid: false,
    invalidReasons: why,
    isFallback: true,
    rawResponse: raw,
    inputJson: input,
    latencyMs: ms,
    attempts,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DecideOptions {
  provider: AiProvider | null;
  cfg: RulesConfig;
  runDate: string;
  isFestival: boolean;
  /** All product names in the master, used to catch an explanation that mentions another product. */
  allNames: string[];
  /** Hard stop for the whole step; remaining flags use the fallback. */
  deadline: number;
  onLog?: (line: string) => void;
}

/** One flag: up to 1 + maxRetries attempts, each retry shows the model what failed. Any failure ends in the fallback. */
export async function decideOne(flag: FlagResult, o: DecideOptions): Promise<DecisionRecord> {
  const input = buildAiInput(flag, o.runDate, o.isFestival, o.cfg);
  const started = Date.now();
  if (!o.provider) {
    return fallbackRecord(flag, input, null, ["No AI provider is configured on the server."], null, 0, 0);
  }
  let errors: string[] = [];
  let raw: string | null = null;
  const maxAttempts = 1 + o.cfg.ai.maxRetries;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() > o.deadline) {
      return fallbackRecord(flag, input, o.provider, ["AI step time budget was used up."], raw, Date.now() - started, attempt - 1);
    }
    try {
      raw = await o.provider.complete({
        system: SYSTEM_PROMPT,
        user: buildUserMessage(input, attempt > 1 ? errors : []),
        timeoutMs: o.cfg.ai.timeoutSeconds * 1000,
      });
      const res = validateDecision(raw, input, o.cfg, o.allNames);
      if (res.valid && res.output) {
        const out = res.output;
        return {
          skuId: flag.skuId,
          provider: o.provider.name,
          model: o.provider.model,
          promptVersion: PROMPT_VERSION,
          action: out.action,
          quantity: out.quantity,
          explanation: out.explanation,
          confidence: out.confidence,
          needsJudgment: out.needs_judgment,
          judgmentNote: out.judgment_note,
          valid: true,
          invalidReasons: [],
          isFallback: false,
          rawResponse: raw,
          inputJson: input,
          latencyMs: Date.now() - started,
          attempts: attempt,
        };
      }
      errors = res.errors;
    } catch (e) {
      errors = [e instanceof Error ? e.message : "Provider failed."];
    }
    o.onLog?.(`${flag.skuId} attempt ${attempt} failed: ${errors.join(" | ")}`);
    if (attempt < maxAttempts) await sleep(o.cfg.ai.retryDelayMs);
  }
  return fallbackRecord(flag, input, o.provider, errors, raw, Date.now() - started, maxAttempts);
}

/** All flags with a small concurrency limit. Order of results matches order of flags. */
export async function decideAll(flags: FlagResult[], o: DecideOptions): Promise<DecisionRecord[]> {
  const results: DecisionRecord[] = new Array(flags.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= flags.length) return;
      results[i] = await decideOne(flags[i], o);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.cfg.ai.concurrency, flags.length) }, worker));
  return results;
}

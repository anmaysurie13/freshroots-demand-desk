import type { RulesConfig } from "../config";
import { lastCompleteWeek, parseDate, weekWindow } from "./weeks";
import type { EngineInput, EngineOutput, FlagResult, FlagType, JudgmentReason, SkippedSku } from "./types";

const EPS = 1e-9;
/** Strict comparisons that tolerate floating point noise, so exact boundaries behave as written. */
const gt = (a: number, b: number) => a - b > EPS;
const lt = (a: number, b: number) => b - a > EPS;

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + EPS);
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Pure rule engine. Same input and same config always give the same output.
 * No I/O, no randomness, no model calls.
 */
export function runRuleEngine(input: EngineInput, cfg: RulesConfig): EngineOutput {
  const f = cfg.forecast;
  const asOf = parseDate(input.asOfDate);
  if (!asOf) throw new Error(`Invalid as-of date: ${input.asOfDate}`);

  const last = lastCompleteWeek(asOf);
  const window12 = weekWindow(last, f.averageWeeks);
  const window4 = weekWindow(last, f.recentWeeks);
  const uplift = input.isFestival ? 1 + f.festivalUpliftPct / 100 : 1;

  const salesBySku = new Map<string, Map<string, number>>();
  for (const s of input.sales) {
    let m = salesBySku.get(s.skuId);
    if (!m) salesBySku.set(s.skuId, (m = new Map()));
    m.set(s.week, s.units);
  }
  const stockBySku = new Map(input.inventory.map((i) => [i.skuId, i.unitsOnHand]));

  const flags: FlagResult[] = [];
  const skipped: SkippedSku[] = [];
  let evaluated = 0;

  for (const sku of [...input.skus].sort((a, b) => a.skuId.localeCompare(b.skuId))) {
    const weeks = salesBySku.get(sku.skuId);
    const onHand = stockBySku.get(sku.skuId);
    if (!weeks || weeks.size === 0) {
      skipped.push({ skuId: sku.skuId, skuName: sku.name, reason: "No sales history (new launch?). Not evaluated by the rules." });
      continue;
    }
    if (onHand === undefined) {
      skipped.push({ skuId: sku.skuId, skuName: sku.name, reason: "No inventory row. Not evaluated." });
      continue;
    }
    evaluated++;

    const series12 = window12.map((w) => weeks.get(w));
    const hist = series12.filter((x) => x !== undefined).length;
    const filled12 = series12.map((x) => x ?? 0);
    const series4 = window4.map((w) => weeks.get(w) ?? 0);

    const avgWeeklySales = mean(filled12);
    const recentAvg = mean(series4);
    const demandRatio = avgWeeklySales > 0 ? recentAvg / avgWeeklySales : 1;
    const demandRate = avgWeeklySales * uplift;
    const coverRaw = demandRate > 0 ? onHand / demandRate : onHand > 0 ? Infinity : 0;

    const perishable = f.perishableLevels.includes(sku.perishability);
    const band = perishable ? f.perishableCover : f.normalCover;

    const flagTypes: FlagType[] = [];
    if (gt(demandRatio, 1 + f.highDemandPct / 100)) flagTypes.push("HIGH_DEMAND");
    if (lt(coverRaw, band.min)) flagTypes.push("STOCKOUT_RISK");
    if (gt(coverRaw, band.max)) flagTypes.push("OVERSTOCK_RISK");
    if (flagTypes.length === 0) continue;

    const reasons: JudgmentReason[] = [];
    if (flagTypes.includes("HIGH_DEMAND") && flagTypes.includes("OVERSTOCK_RISK")) {
      reasons.push({
        code: "CONFLICTING_FLAGS",
        text: "Demand is rising while stock is above the maximum cover. The signals conflict.",
      });
    }
    if (hist < f.minWeeksHistory) {
      reasons.push({ code: "SHORT_HISTORY", text: `Only ${hist} of the last ${f.averageWeeks} weeks have sales data.` });
    }
    if (series12.some((x) => x === 0)) {
      reasons.push({ code: "ZERO_SALES_WEEK", text: `At least one of the last ${f.averageWeeks} weeks shows zero units sold.` });
    }
    for (let i = 1; i < series4.length; i++) {
      const prev = series4[i - 1];
      const cur = series4[i];
      if (prev > 0 && gt(Math.abs(cur - prev) / prev, f.swingPct / 100)) {
        reasons.push({
          code: "WEEKLY_SWING",
          text: `Sales moved by more than ${f.swingPct}% between two of the last ${f.recentWeeks} weeks.`,
        });
        break;
      }
    }

    const conflicting = reasons.some((r) => r.code === "CONFLICTING_FLAGS");
    let ruleAction: FlagResult["ruleAction"];
    let multiplier: number;
    if (conflicting) {
      ruleAction = "PAUSE_ORDER";
      multiplier = 0;
    } else if (flagTypes.includes("HIGH_DEMAND")) {
      ruleAction = "REORDER";
      multiplier = f.highDemandMultiplier;
    } else if (flagTypes.includes("STOCKOUT_RISK")) {
      ruleAction = "REORDER";
      multiplier = f.stockoutMultiplier;
    } else {
      ruleAction = "PAUSE_ORDER";
      multiplier = 0;
    }

    flags.push({
      skuId: sku.skuId,
      skuName: sku.name,
      category: sku.category,
      perishability: sku.perishability,
      standardQty: sku.standardQty,
      uom: sku.uom,
      distributorId: sku.distributorId,
      flagTypes,
      avgWeeklySales,
      recentAvg,
      demandRatio,
      uplift,
      demandRate,
      unitsOnHand: onHand,
      coverWeeks: Number.isFinite(coverRaw) ? coverRaw : null,
      minCover: band.min,
      maxCover: band.max,
      ruleAction,
      ruleQty: ruleAction === "REORDER" ? roundHalfUp(sku.standardQty * multiplier) : 0,
      multiplier,
      needsJudgment: reasons.length > 0,
      judgmentReasons: reasons,
    });
  }

  return {
    lastCompleteWeek: last,
    window12,
    window4,
    uplift,
    evaluated,
    unflagged: evaluated - flags.length,
    flags,
    skipped,
  };
}

import type { RulesConfig } from "../config";

export type Kill2State = "green" | "alert" | "killed";

export interface Kill1Result {
  reviewed: number;
  reversed: number;
  /** Percentage 0-100, or null before any decision is reviewed. */
  ratePct: number | null;
  collecting: boolean;
  fire: boolean;
}

/** Kill 1: fires at the threshold or above, once the minimum sample has been reviewed. */
export function evaluateKill1(reviewed: number, reversed: number, cfg: RulesConfig): Kill1Result {
  const k = cfg.kill1;
  const ratePct = reviewed > 0 ? (reversed / reviewed) * 100 : null;
  const enough = reviewed >= k.minReviewed;
  // Integer cross-multiplication avoids float edge cases at exactly the threshold.
  const atOrAbove = reviewed > 0 && reversed * 100 >= k.thresholdPct * reviewed;
  return { reviewed, reversed, ratePct, collecting: !enough, fire: k.enabled && enough && atOrAbove };
}

/** Kill 2: strictly above the alert level alerts, strictly above the kill level kills. */
export function evaluateKill2(quarterToDateLoss: number, cfg: RulesConfig): Kill2State {
  const k = cfg.kill2;
  if (!k.enabled) return "green";
  if (quarterToDateLoss > k.killAbove) return "killed";
  if (quarterToDateLoss > k.alertAbove) return "alert";
  return "green";
}

/** Calendar quarter containing an ISO date (Jan-Mar is Q1). Start and end are inclusive. */
export function quarterBounds(isoDate: string): { label: string; start: string; end: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    label: `Q${q + 1} ${y}`,
    start: `${y}-${pad(startMonth)}-01`,
    end: `${y}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

/** An entry counts toward the quarter in which its period starts. */
export function quarterToDateLoss(
  entries: { periodStart: string; stockout: number; overstock: number }[],
  quarter: { start: string; end: string },
): number {
  return entries
    .filter((e) => e.periodStart >= quarter.start && e.periodStart <= quarter.end)
    .reduce((s, e) => s + e.stockout + e.overstock, 0);
}

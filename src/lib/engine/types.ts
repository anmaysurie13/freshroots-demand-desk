export type Perishability = "Low" | "High";
export type FlagType = "HIGH_DEMAND" | "STOCKOUT_RISK" | "OVERSTOCK_RISK";
export type Action = "REORDER" | "PAUSE_ORDER" | "NO_ACTION";
export type JudgmentCode = "CONFLICTING_FLAGS" | "SHORT_HISTORY" | "ZERO_SALES_WEEK" | "WEEKLY_SWING";

export interface SkuMaster {
  skuId: string;
  name: string;
  category: string;
  perishability: Perishability;
  standardQty: number;
  uom: string;
  distributorId: string;
}

export interface SalesRow {
  skuId: string;
  week: string;
  units: number;
}

export interface InventoryRow {
  skuId: string;
  location: string;
  unitsOnHand: number;
  asOfDate: string;
}

export interface EngineInput {
  /** YYYY-MM-DD, taken from the inventory file. */
  asOfDate: string;
  skus: SkuMaster[];
  sales: SalesRow[];
  inventory: InventoryRow[];
  /** Whether the month of asOfDate is a festival month in the calendar. */
  isFestival: boolean;
}

export interface JudgmentReason {
  code: JudgmentCode;
  text: string;
}

export interface FlagResult {
  skuId: string;
  skuName: string;
  category: string;
  perishability: Perishability;
  standardQty: number;
  uom: string;
  distributorId: string;
  flagTypes: FlagType[];
  avgWeeklySales: number;
  recentAvg: number;
  demandRatio: number;
  uplift: number;
  demandRate: number;
  unitsOnHand: number;
  /** Null when demand rate is zero (cover is unbounded). */
  coverWeeks: number | null;
  minCover: number;
  maxCover: number;
  ruleAction: Exclude<Action, "NO_ACTION">;
  ruleQty: number;
  multiplier: number;
  needsJudgment: boolean;
  judgmentReasons: JudgmentReason[];
}

export interface SkippedSku {
  skuId: string;
  skuName: string;
  reason: string;
}

export interface EngineOutput {
  lastCompleteWeek: string;
  window12: string[];
  window4: string[];
  uplift: number;
  evaluated: number;
  unflagged: number;
  flags: FlagResult[];
  skipped: SkippedSku[];
}

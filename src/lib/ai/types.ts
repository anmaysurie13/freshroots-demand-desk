import type { Action, FlagType } from "../engine/types";

/** Exactly what is sent to the model for one flag. No names of people, prices or supplier details. */
export interface AiInput {
  run_date: string;
  is_festival_month: boolean;
  sku: {
    sku_id: string;
    name: string;
    category: string;
    perishability: string;
    standard_reorder_qty: number;
    unit: string;
  };
  metrics: {
    avg_weekly_sales: number;
    recent_4wk_avg: number;
    demand_ratio: number;
    festival_uplift: number;
    demand_rate: number;
    units_on_hand: number;
    cover_weeks: number | null;
    min_cover_weeks: number;
    max_cover_weeks: number;
  };
  flags: FlagType[];
  rule_engine: { action: Exclude<Action, "NO_ACTION">; quantity: number; multiplier: number };
  allowed_actions: Array<"REORDER" | "PAUSE_ORDER">;
  quantity_limits: { min: number; max: number };
  needs_judgment_from_engine: boolean;
  judgment_reasons: string[];
}

export interface AiOutput {
  sku_id: string;
  action: "REORDER" | "PAUSE_ORDER";
  quantity: number;
  explanation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  needs_judgment: boolean;
  judgment_note: string | null;
}

export interface CompletionRequest {
  system: string;
  user: string;
  timeoutMs: number;
}

/** A provider returns the model's raw JSON text. Anything it throws is treated as an API failure. */
export interface AiProvider {
  name: string;
  model: string;
  complete(req: CompletionRequest): Promise<string>;
}

export interface DecisionRecord {
  skuId: string;
  provider: string;
  model: string;
  promptVersion: string;
  action: "REORDER" | "PAUSE_ORDER";
  quantity: number;
  explanation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  needsJudgment: boolean;
  judgmentNote: string | null;
  valid: boolean;
  invalidReasons: string[];
  isFallback: boolean;
  rawResponse: string | null;
  inputJson: AiInput;
  latencyMs: number;
  attempts: number;
}

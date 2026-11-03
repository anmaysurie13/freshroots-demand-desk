import { z } from "zod";
import type { RulesConfig } from "../config";
import type { AiInput, AiOutput } from "./types";

const OutputSchema = z.strictObject({
  sku_id: z.string(),
  action: z.enum(["REORDER", "PAUSE_ORDER"]),
  quantity: z.number().int().min(0),
  explanation: z.string(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  needs_judgment: z.boolean(),
  judgment_note: z.string().max(200).nullable(),
});

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  output: AiOutput | null;
}

function decimals(s: string): number {
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

function roundTo(x: number, d: number): number {
  const p = 10 ** d;
  return Math.round(x * p + 1e-9) / p;
}

/** Every number the explanation is allowed to quote, built only from the input and fixed config windows. */
export function allowedNumbers(input: AiInput, cfg: RulesConfig): number[] {
  const out: number[] = [];
  const push = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n)) out.push(n);
  };
  const m = input.metrics;
  [
    m.avg_weekly_sales, m.recent_4wk_avg, m.demand_ratio, m.festival_uplift, m.demand_rate, m.units_on_hand,
    m.cover_weeks, m.min_cover_weeks, m.max_cover_weeks,
    input.sku.standard_reorder_qty, input.rule_engine.quantity, input.rule_engine.multiplier,
    input.quantity_limits.min, input.quantity_limits.max, 0,
    cfg.forecast.recentWeeks, cfg.forecast.averageWeeks, cfg.forecast.highDemandPct,
  ].forEach(push);
  // Percent above average, and the festival uplift as a percentage.
  push((m.demand_ratio - 1) * 100);
  push(Math.abs(m.demand_ratio - 1) * 100);
  push((m.festival_uplift - 1) * 100);
  // Date parts (the run date) and any numbers inside the product name.
  for (const part of input.run_date.split("-")) push(Number(part));
  for (const hit of input.sku.name.match(/\d+(?:\.\d+)?/g) ?? []) push(Number(hit));
  return out;
}

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/** Numbers written in the text that do not match any allowed number at the precision they were written. */
export function inventedNumbers(text: string, input: AiInput, cfg: RulesConfig, extra: number[] = []): string[] {
  const allowed = [...allowedNumbers(input, cfg), ...extra];
  let scrubbed = text;
  // The SKU's own id and name may be quoted, so their digits are not "numbers".
  scrubbed = scrubbed.split(input.sku.sku_id).join(" ");
  scrubbed = scrubbed.split(input.sku.name).join(" ");
  const bad: string[] = [];
  for (const raw of scrubbed.match(NUMBER_RE) ?? []) {
    const cleaned = raw.replace(/,/g, "").replace(/\.$/, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) continue;
    const d = decimals(cleaned);
    if (!allowed.some((a) => roundTo(a, d) === n)) bad.push(raw);
  }
  return bad;
}

/** Strip a markdown code fence if a model adds one despite instructions. */
function unfence(raw: string): string {
  const t = raw.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

export function validateDecision(
  raw: string,
  input: AiInput,
  cfg: RulesConfig,
  otherNames: string[] = [],
): ValidationResult {
  const errors: string[] = [];

  let json: unknown;
  try {
    json = JSON.parse(unfence(raw));
  } catch {
    return { valid: false, errors: ["Response is not valid JSON."], output: null };
  }
  const parsed = OutputSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "response"}: ${i.message}`);
    return { valid: false, errors: [`Response does not match the schema (${issues.join("; ")}).`], output: null };
  }
  const o = parsed.data;

  if (o.sku_id !== input.sku.sku_id) errors.push(`sku_id must be ${input.sku.sku_id}.`);
  if (!input.allowed_actions.includes(o.action)) errors.push(`action must be one of ${input.allowed_actions.join(", ")}.`);
  if (o.action === "PAUSE_ORDER" && o.quantity !== 0) errors.push("quantity must be 0 for PAUSE_ORDER.");
  if (o.quantity < input.quantity_limits.min || o.quantity > input.quantity_limits.max) {
    errors.push(`quantity must be between ${input.quantity_limits.min} and ${input.quantity_limits.max}.`);
  }
  if (o.explanation.length < 40 || o.explanation.length > 450) {
    errors.push(`explanation must be 40 to 450 characters (it was ${o.explanation.length}).`);
  }
  // The model's own quantity may be quoted only when it is inside the allowed range (checked above).
  const ownQty = o.quantity >= input.quantity_limits.min && o.quantity <= input.quantity_limits.max ? [o.quantity] : [];
  const invented = inventedNumbers(o.explanation, input, cfg, ownQty);
  if (invented.length) errors.push(`explanation uses numbers that are not in the input: ${invented.join(", ")}.`);

  const ids = o.explanation.match(/\bSKU\s?-?\d+\b/gi) ?? [];
  if (ids.some((x) => x.replace(/[\s-]/g, "").toUpperCase() !== input.sku.sku_id.toUpperCase())) {
    errors.push("explanation mentions another SKU id.");
  }
  const lower = o.explanation.toLowerCase();
  const own = input.sku.name.toLowerCase();
  if (otherNames.some((n) => n && n.toLowerCase() !== own && lower.includes(n.toLowerCase()))) {
    errors.push("explanation mentions another product.");
  }

  if (input.needs_judgment_from_engine && !o.needs_judgment) {
    errors.push("needs_judgment must be true because the rule engine set it.");
  }
  if (o.confidence === "LOW" && !o.needs_judgment) errors.push("LOW confidence requires needs_judgment to be true.");

  return { valid: errors.length === 0, errors, output: errors.length === 0 ? (o as AiOutput) : null };
}

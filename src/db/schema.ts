import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const ROLES = ["raghav", "procurement", "priya", "deepa", "ceo", "admin"] as const;
export type Role = (typeof ROLES)[number];

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const dataSnapshots = pgTable("data_snapshots", {
  id: serial("id").primaryKey(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  asOfDate: text("as_of_date").notNull(),
  isSample: boolean("is_sample").notNull().default(false),
  /** Raw uploaded text per file, kept so any result can be reproduced. */
  rawFiles: jsonb("raw_files").$type<Record<string, string>>().notNull(),
  validationReport: jsonb("validation_report").notNull(),
});

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => dataSnapshots.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rulesVersion: text("rules_version").notNull(),
  rulesJson: jsonb("rules_json").notNull(),
  asOfDate: text("as_of_date").notNull(),
  lastCompleteWeek: text("last_complete_week").notNull(),
  isFestival: boolean("is_festival").notNull(),
  /** created | flagged | ai_done | in_review | completed | blocked */
  status: text("status").notNull().default("flagged"),
  evaluatedSkus: integer("evaluated_skus").notNull().default(0),
  skippedJson: jsonb("skipped_json").notNull().default([]),
  killStateAtRun: text("kill_state_at_run").notNull().default("armed"),
  aiStartedAt: timestamp("ai_started_at", { withTimezone: true }),
  aiFinishedAt: timestamp("ai_finished_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const flags = pgTable(
  "flags",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => runs.id),
    skuId: text("sku_id").notNull(),
    skuName: text("sku_name").notNull(),
    category: text("category").notNull(),
    perishability: text("perishability").notNull(),
    uom: text("uom").notNull(),
    distributorId: text("distributor_id").notNull(),
    standardQty: integer("standard_qty").notNull(),
    flagTypes: jsonb("flag_types").$type<string[]>().notNull(),
    avgWeeklySales: numeric("avg_weekly_sales", { precision: 14, scale: 4 }).notNull(),
    recentAvg: numeric("recent_avg", { precision: 14, scale: 4 }).notNull(),
    demandRatio: numeric("demand_ratio", { precision: 10, scale: 6 }).notNull(),
    uplift: numeric("uplift", { precision: 6, scale: 3 }).notNull(),
    demandRate: numeric("demand_rate", { precision: 14, scale: 4 }).notNull(),
    unitsOnHand: integer("units_on_hand").notNull(),
    coverWeeks: numeric("cover_weeks", { precision: 12, scale: 4 }),
    minCover: numeric("min_cover", { precision: 6, scale: 2 }).notNull(),
    maxCover: numeric("max_cover", { precision: 6, scale: 2 }).notNull(),
    ruleAction: text("rule_action").notNull(),
    ruleQty: integer("rule_qty").notNull(),
    needsJudgment: boolean("needs_judgment").notNull(),
    judgmentReasons: jsonb("judgment_reasons").$type<{ code: string; text: string }[]>().notNull(),
  },
  (t) => [index("flags_run_idx").on(t.runId)],
);

export const aiDecisions = pgTable(
  "ai_decisions",
  {
    id: serial("id").primaryKey(),
    flagId: integer("flag_id").notNull().references(() => flags.id),
    runId: integer("run_id").notNull().references(() => runs.id),
    /** pending_review | reviewed | voided_by_kill */
    status: text("status").notNull().default("pending_review"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    action: text("action").notNull(),
    quantity: integer("quantity").notNull(),
    explanation: text("explanation").notNull(),
    confidence: text("confidence"),
    needsJudgment: boolean("needs_judgment").notNull(),
    judgmentNote: text("judgment_note"),
    valid: boolean("valid").notNull(),
    invalidReasons: jsonb("invalid_reasons").$type<string[]>().notNull(),
    isFallback: boolean("is_fallback").notNull(),
    inputJson: jsonb("input_json").notNull(),
    rawResponse: text("raw_response"),
    latencyMs: integer("latency_ms").notNull(),
    attempts: integer("attempts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_decisions_flag_uq").on(t.flagId), index("ai_decisions_run_idx").on(t.runId)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    aiDecisionId: integer("ai_decision_id").notNull().references(() => aiDecisions.id),
    reviewerId: integer("reviewer_id").notNull().references(() => users.id),
    /** accepted | rejected */
    outcome: text("outcome").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    finalAction: text("final_action").notNull(),
    finalQty: integer("final_qty").notNull(),
    finalFlagTypes: jsonb("final_flag_types").$type<string[]>().notNull(),
    /** Rejected and the final action or quantity differs from the AI's. This is what Kill 1 counts. */
    isReversal: boolean("is_reversal").notNull().default(false),
    reasonCode: text("reason_code"),
    reasonText: text("reason_text"),
    breakGlass: boolean("break_glass").notNull().default(false),
  },
  (t) => [uniqueIndex("reviews_decision_uq").on(t.aiDecisionId)],
);

export const buyingDecisions = pgTable(
  "buying_decisions",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id").notNull().references(() => reviews.id),
    runId: integer("run_id").notNull().references(() => runs.id),
    skuId: text("sku_id").notNull(),
    skuName: text("sku_name").notNull(),
    action: text("action").notNull(),
    quantity: integer("quantity").notNull(),
    /** ai_accepted | raghav_changed */
    source: text("source").notNull(),
    reasonCode: text("reason_code"),
    sink: text("sink").notNull().default("csv"),
    sinkRef: text("sink_ref"),
    /** pending | placed | held */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    placedBy: integer("placed_by").references(() => users.id),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    orderRef: text("order_ref"),
  },
  (t) => [uniqueIndex("buying_review_uq").on(t.reviewId), index("buying_status_idx").on(t.status)],
);

export const lossEntries = pgTable(
  "loss_entries",
  {
    id: serial("id").primaryKey(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    stockoutLoss: money("stockout_loss_rupees").notNull(),
    overstockWriteoff: money("overstock_writeoff_rupees").notNull(),
    enteredBy: integer("entered_by").references(() => users.id),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [uniqueIndex("loss_period_uq").on(t.periodStart, t.periodEnd)],
);

export const killState = pgTable("kill_state", {
  id: integer("id").primaryKey(),
  /** armed | killed */
  kill1State: text("kill1_state").notNull().default("armed"),
  /** green | alert | killed */
  kill2State: text("kill2_state").notNull().default("green"),
  kill1EpochStart: timestamp("kill1_epoch_start", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const killEvents = pgTable("kill_events", {
  id: serial("id").primaryKey(),
  switch: integer("switch").notNull(),
  /** alert | killed | rearmed */
  event: text("event").notNull(),
  metricValue: numeric("metric_value", { precision: 16, scale: 4 }),
  threshold: numeric("threshold", { precision: 16, scale: 4 }),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: integer("actor_id").references(() => users.id),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_action_idx").on(t.action), index("audit_created_idx").on(t.createdAt)],
);

export const emailOutbox = pgTable("email_outbox", {
  id: serial("id").primaryKey(),
  toRole: text("to_role").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  provider: text("provider").notNull(),
  /** logged | sent | failed */
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


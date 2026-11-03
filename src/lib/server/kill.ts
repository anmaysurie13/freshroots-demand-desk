import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { getDb, schema } from "@/db";
import { rulesConfig } from "../config";
import { evaluateKill1, evaluateKill2, quarterBounds, type Kill1Result, type Kill2State } from "../kill/logic";
import { HttpError, type SessionUser } from "./auth";
import { audit } from "./audit";
import { queueEmail } from "./email";

type Executor = Tx | ReturnType<typeof getDb>;

export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: rulesConfig.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function getKillRow(ex: Executor = getDb()) {
  const [row] = await ex.select().from(schema.killState).where(eq(schema.killState.id, 1));
  if (!row) throw new Error("kill_state row is missing. Run the seed script.");
  return row;
}

export async function automationStopped(ex: Executor = getDb()): Promise<{ stopped: boolean; kill1: boolean; kill2: boolean }> {
  const k = await getKillRow(ex);
  const kill1 = k.kill1State === "killed";
  const kill2 = k.kill2State === "killed";
  return { stopped: kill1 || kill2, kill1, kill2 };
}

export async function kill1Counts(ex: Executor, epoch: Date): Promise<Kill1Result> {
  const [row] = await ex
    .select({
      reviewed: count(),
      reversed: sql<number>`count(*) filter (where ${schema.reviews.isReversal})`.mapWith(Number),
    })
    .from(schema.aiDecisions)
    .innerJoin(schema.reviews, eq(schema.reviews.aiDecisionId, schema.aiDecisions.id))
    .where(and(eq(schema.aiDecisions.isFallback, false), gte(schema.reviews.reviewedAt, epoch)));
  return evaluateKill1(Number(row.reviewed), Number(row.reversed), rulesConfig);
}

export async function quarterLoss(ex: Executor, today = todayIst()) {
  const q = quarterBounds(today);
  const [row] = await ex
    .select({
      stockout: sql<string>`coalesce(sum(${schema.lossEntries.stockoutLoss}), 0)`,
      overstock: sql<string>`coalesce(sum(${schema.lossEntries.overstockWriteoff}), 0)`,
    })
    .from(schema.lossEntries)
    .where(and(gte(schema.lossEntries.periodStart, q.start), sql`${schema.lossEntries.periodStart} <= ${q.end}`));
  const stockout = Number(row.stockout);
  const overstock = Number(row.overstock);
  return { quarter: q, stockout, overstock, total: stockout + overstock };
}

const STOP_TEXT = "Automation stopped. New runs and the AI step are blocked. Use the previous process.";

async function performKill(tx: Tx, sw: 1 | 2, metric: number, threshold: number, details: Record<string, unknown>, actor: SessionUser | null) {
  const now = new Date();
  await tx
    .update(schema.killState)
    .set(sw === 1 ? { kill1State: "killed", updatedAt: now } : { kill2State: "killed", updatedAt: now })
    .where(eq(schema.killState.id, 1));
  const [ev] = await tx
    .insert(schema.killEvents)
    .values({ switch: sw, event: "killed", metricValue: String(metric), threshold: String(threshold), details })
    .returning({ id: schema.killEvents.id });

  const voided = await tx
    .update(schema.aiDecisions)
    .set({ status: "voided_by_kill" })
    .where(eq(schema.aiDecisions.status, "pending_review"))
    .returning({ id: schema.aiDecisions.id });
  const held = await tx
    .update(schema.buyingDecisions)
    .set({ status: "held" })
    .where(eq(schema.buyingDecisions.status, "pending"))
    .returning({ id: schema.buyingDecisions.id });
  await tx
    .update(schema.runs)
    .set({ status: "blocked" })
    .where(inArray(schema.runs.status, ["flagged", "ai_running", "in_review"]));

  await audit(tx, {
    actor,
    systemLabel: "kill-switch monitor",
    action: `kill${sw}.fired`,
    entity: "kill_state",
    entityId: ev.id,
    after: { metric, threshold, voidedDecisions: voided.length, heldBuyingDecisions: held.length, ...details },
  });
  await queueEmail(
    tx,
    ["raghav", "deepa", "ceo", "priya"],
    `Kill ${sw} fired: automation stopped`,
    `${STOP_TEXT}\nMetric: ${metric}. Threshold: ${threshold}.\nUnreviewed AI decisions voided: ${voided.length}. Buying decisions held: ${held.length}.`,
  );
}

/** Kill 1 is evaluated after every review. Idempotent: a second call while killed writes nothing. */
export async function evaluateKill1AfterReview(actor: SessionUser | null): Promise<{ fired: boolean; result: Kill1Result }> {
  return getDb().transaction(async (tx) => {
    const [k] = await tx.select().from(schema.killState).where(eq(schema.killState.id, 1)).for("update");
    const result = await kill1Counts(tx, k.kill1EpochStart);
    if (k.kill1State === "killed" || !result.fire) return { fired: false, result };
    await performKill(tx, 1, result.ratePct ?? 0, rulesConfig.kill1.thresholdPct, { reviewed: result.reviewed, reversed: result.reversed }, actor);
    return { fired: true, result };
  });
}

/** Kill 2 is evaluated after every loss entry and once a day by the scheduled job. Idempotent. */
export async function evaluateKill2Now(
  actor: SessionUser | null,
  today = todayIst(),
): Promise<{ state: Kill2State; total: number; changed: boolean }> {
  return getDb().transaction(async (tx) => {
    const [k] = await tx.select().from(schema.killState).where(eq(schema.killState.id, 1)).for("update");
    const q = await quarterLoss(tx, today);
    if (k.kill2State === "killed") return { state: "killed" as const, total: q.total, changed: false };
    const next = evaluateKill2(q.total, rulesConfig);
    if (next === k.kill2State) return { state: next, total: q.total, changed: false };

    const details = { quarter: q.quarter.label, stockout: q.stockout, overstock: q.overstock };
    if (next === "killed") {
      await performKill(tx, 2, q.total, rulesConfig.kill2.killAbove, details, actor);
    } else if (next === "alert") {
      await tx.update(schema.killState).set({ kill2State: "alert", updatedAt: new Date() }).where(eq(schema.killState.id, 1));
      const [ev] = await tx
        .insert(schema.killEvents)
        .values({ switch: 2, event: "alert", metricValue: String(q.total), threshold: String(rulesConfig.kill2.alertAbove), details })
        .returning({ id: schema.killEvents.id });
      await audit(tx, { actor, systemLabel: "kill-switch monitor", action: "kill2.alert", entity: "kill_state", entityId: ev.id, after: { total: q.total, ...details } });
      await queueEmail(
        tx,
        ["raghav", "deepa", "ceo"],
        "Kill 2 alert: quarterly loss is above Rs 28 lakh",
        `Quarter-to-date loss for ${q.quarter.label} is Rs ${q.total.toLocaleString("en-IN")}, above the alert level of Rs ${rulesConfig.kill2.alertAbove.toLocaleString("en-IN")}. Monitor closely: Deepa reviews weekly and acknowledges in the app.`,
      );
    } else {
      await tx.update(schema.killState).set({ kill2State: "green", updatedAt: new Date() }).where(eq(schema.killState.id, 1));
      await audit(tx, { actor, systemLabel: "kill-switch monitor", action: "kill2.cleared", entity: "kill_state", after: { total: q.total, ...details } });
    }
    return { state: next, total: q.total, changed: true };
  });
}

export async function rearm(sw: 1 | 2, user: SessionUser, reasonRaw: string, confirmRefire: boolean) {
  const reason = reasonRaw.trim();
  if (reason.length < 20) throw new HttpError(400, "A written reason of at least 20 characters is required.");
  const refireTotal = await getDb().transaction(async (tx) => {
    const [k] = await tx.select().from(schema.killState).where(eq(schema.killState.id, 1)).for("update");
    const isKilled = sw === 1 ? k.kill1State === "killed" : k.kill2State === "killed";
    if (!isKilled) throw new HttpError(409, `Kill ${sw} is not active.`);

    let willRefire = false;
    let total = 0;
    if (sw === 2) {
      const q = await quarterLoss(tx);
      total = q.total;
      willRefire = q.total > rulesConfig.kill2.killAbove;
      if (willRefire && !confirmRefire) {
        throw new HttpError(409, "Quarter-to-date loss is still above the kill level, so Kill 2 will fire again straight away.", {
          needsConfirm: true,
          total,
        });
      }
    }
    const now = new Date();
    await tx
      .update(schema.killState)
      .set(sw === 1 ? { kill1State: "armed", kill1EpochStart: now, updatedAt: now } : { kill2State: "green", updatedAt: now })
      .where(eq(schema.killState.id, 1));
    const [ev] = await tx
      .insert(schema.killEvents)
      .values({ switch: sw, event: "rearmed", details: { reason, by: user.name, role: user.role, willRefire } })
      .returning({ id: schema.killEvents.id });
    await audit(tx, { actor: user, action: `kill${sw}.rearmed`, entity: "kill_state", entityId: ev.id, after: { reason, willRefire } });
    return willRefire;
  });
  if (sw === 2) await evaluateKill2Now(user);
  return { refired: refireTotal };
}

export async function acknowledgeAlert(eventId: number, user: SessionUser) {
  await getDb().transaction(async (tx) => {
    const [ev] = await tx.select().from(schema.killEvents).where(eq(schema.killEvents.id, eventId));
    if (!ev || ev.event !== "alert") throw new HttpError(404, "Alert not found.");
    if (ev.acknowledgedAt) throw new HttpError(409, "Already acknowledged.");
    await tx.update(schema.killEvents).set({ acknowledgedBy: user.id, acknowledgedAt: new Date() }).where(eq(schema.killEvents.id, eventId));
    await audit(tx, { actor: user, action: "kill2.alert_acknowledged", entity: "kill_events", entityId: eventId });
  });
}

export async function latestKillEvents(limit = 30) {
  return getDb().select().from(schema.killEvents).orderBy(desc(schema.killEvents.id)).limit(limit);
}

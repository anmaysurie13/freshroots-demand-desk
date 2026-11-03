import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { checkReview, type ReviewRequest } from "../review-rules";
import { HttpError, type SessionUser } from "./auth";
import { audit } from "./audit";
import { automationStopped, evaluateKill1AfterReview } from "./kill";
import { STOP_MESSAGE } from "./runs";

export interface ReviewSaved {
  reviewId: number;
  buyingDecisionId: number | null;
  runCompleted: boolean;
  killFired: boolean;
}

/**
 * Saves one review. Reviews are append-only: there is no update path.
 * Only raghav (or admin as an audited break-glass) reaches this; the route checks the role.
 */
export async function reviewDecision(decisionId: number, user: SessionUser, req: ReviewRequest): Promise<ReviewSaved> {
  const db = getDb();
  if ((await automationStopped(db)).stopped) throw new HttpError(409, STOP_MESSAGE);

  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ d: schema.aiDecisions, f: schema.flags, runStatus: schema.runs.status })
      .from(schema.aiDecisions)
      .innerJoin(schema.flags, eq(schema.flags.id, schema.aiDecisions.flagId))
      .innerJoin(schema.runs, eq(schema.runs.id, schema.aiDecisions.runId))
      .where(eq(schema.aiDecisions.id, decisionId))
      .for("update", { of: schema.aiDecisions });
    if (!row) throw new HttpError(404, "Decision not found.");
    if (row.d.status === "voided_by_kill") throw new HttpError(409, "This decision was voided when a kill switch fired.");
    if (row.d.status !== "pending_review" || row.runStatus !== "in_review") throw new HttpError(409, "This decision has already been reviewed.");

    const check = checkReview({ action: row.d.action, quantity: row.d.quantity, flagTypes: row.f.flagTypes }, req);
    if (!check.ok) throw new HttpError(400, check.error);
    const fin = check.final;
    const breakGlass = user.role === "admin";

    const [review] = await tx
      .insert(schema.reviews)
      .values({
        aiDecisionId: decisionId,
        reviewerId: user.id,
        outcome: req.outcome,
        finalAction: fin.action,
        finalQty: fin.qty,
        finalFlagTypes: fin.flagTypes,
        isReversal: fin.isReversal,
        reasonCode: fin.reasonCode,
        reasonText: fin.reasonText,
        breakGlass,
      })
      .returning({ id: schema.reviews.id });
    await tx.update(schema.aiDecisions).set({ status: "reviewed" }).where(eq(schema.aiDecisions.id, decisionId));

    // Only reviewed decisions can reach buying. NO_ACTION means nothing to buy, so no buying decision is made.
    let buyingId: number | null = null;
    if (fin.action !== "NO_ACTION") {
      const [b] = await tx
        .insert(schema.buyingDecisions)
        .values({
          reviewId: review.id,
          runId: row.d.runId,
          skuId: row.f.skuId,
          skuName: row.f.skuName,
          action: fin.action,
          quantity: fin.qty,
          source: req.outcome === "accepted" ? "ai_accepted" : "raghav_changed",
          reasonCode: fin.reasonCode,
        })
        .returning({ id: schema.buyingDecisions.id });
      buyingId = b.id;
    }

    await audit(tx, {
      actor: user,
      action: breakGlass ? "review.break_glass" : "review.saved",
      entity: "reviews",
      entityId: review.id,
      before: { aiAction: row.d.action, aiQty: row.d.quantity, flags: row.f.flagTypes, sku: row.f.skuId },
      after: { outcome: req.outcome, action: fin.action, qty: fin.qty, flags: fin.flagTypes, reversal: fin.isReversal, reason: fin.reasonCode },
    });

    const [{ pending }] = await tx
      .select({ pending: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.aiDecisions)
      .where(and(eq(schema.aiDecisions.runId, row.d.runId), eq(schema.aiDecisions.status, "pending_review")));
    let runCompleted = false;
    if (pending === 0) {
      await tx.update(schema.runs).set({ status: "completed", completedAt: new Date() }).where(eq(schema.runs.id, row.d.runId));
      await audit(tx, { actor: user, action: "run.completed", entity: "runs", entityId: row.d.runId });
      runCompleted = true;
    }
    return { reviewId: review.id, buyingDecisionId: buyingId, runCompleted };
  });

  // Kill 1 is checked after every saved review, outside the review transaction.
  const k = await evaluateKill1AfterReview(user);
  return { ...saved, killFired: k.fired };
}

/** Accept only the rows the client showed, and only if none needs judgment or is a fallback. */
export async function bulkAccept(runId: number, decisionIds: number[], user: SessionUser) {
  if (!decisionIds.length) throw new HttpError(400, "No decisions were listed.");
  const db = getDb();
  const rows = await db
    .select({ d: schema.aiDecisions })
    .from(schema.aiDecisions)
    .where(and(eq(schema.aiDecisions.runId, runId), inArray(schema.aiDecisions.id, decisionIds)));
  if (rows.length !== decisionIds.length) throw new HttpError(400, "Some decisions do not belong to this run.");
  const bad = rows.filter(({ d }) => d.needsJudgment || d.isFallback || d.status !== "pending_review");
  if (bad.length) {
    throw new HttpError(400, "Bulk accept is only for rows that are not needs-judgment, not fallback and still pending.", {
      rejectedIds: bad.map(({ d }) => d.id),
    });
  }
  let accepted = 0;
  let killFired = false;
  for (const { d } of rows) {
    const r = await reviewDecision(d.id, user, { outcome: "accepted" });
    accepted++;
    if (r.killFired) {
      killFired = true;
      break;
    }
  }
  await audit(db, { actor: user, action: "review.bulk_accept", entity: "runs", entityId: runId, after: { accepted, requested: decisionIds.length } });
  return { accepted, killFired };
}

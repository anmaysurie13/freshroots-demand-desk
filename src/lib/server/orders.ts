import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { HubSpotError, createDeal, dealPayload, hubspotConfigured } from "../orders/hubspot";
import { buyingCsv, type BuyingDecision } from "../orders/sink";
import { HttpError, type SessionUser } from "./auth";
import { audit } from "./audit";

export async function listBuyingDecisions(): Promise<(BuyingDecision & { placedAt: Date | null; orderRef: string | null })[]> {
  const rows = await getDb()
    .select({ b: schema.buyingDecisions, asOf: schema.runs.asOfDate })
    .from(schema.buyingDecisions)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.buyingDecisions.runId))
    .orderBy(desc(schema.buyingDecisions.id));
  return rows.map(({ b, asOf }) => ({
    id: b.id,
    runId: b.runId,
    skuId: b.skuId,
    skuName: b.skuName,
    action: b.action,
    quantity: b.quantity,
    source: b.source,
    reasonCode: b.reasonCode,
    status: b.status,
    sink: b.sink,
    sinkRef: b.sinkRef,
    asOfDate: asOf,
    createdAt: b.createdAt,
    placedAt: b.placedAt,
    orderRef: b.orderRef,
  }));
}

export async function markPlaced(id: number, user: SessionUser, orderRef: string, confirmedWithRaghav: boolean) {
  const ref = orderRef.trim().slice(0, 60);
  await getDb().transaction(async (tx) => {
    const [b] = await tx.select().from(schema.buyingDecisions).where(eq(schema.buyingDecisions.id, id)).for("update");
    if (!b) throw new HttpError(404, "Buying decision not found.");
    if (b.status === "placed") throw new HttpError(409, "Already marked as placed.");
    if (b.status === "held" && !confirmedWithRaghav) {
      throw new HttpError(400, "This item is held. Confirm with Raghav before ordering, then tick the confirmation.");
    }
    await tx
      .update(schema.buyingDecisions)
      .set({ status: "placed", placedBy: user.id, placedAt: new Date(), orderRef: ref || null })
      .where(eq(schema.buyingDecisions.id, id));
    await audit(tx, {
      actor: user,
      action: "order.placed",
      entity: "buying_decisions",
      entityId: id,
      before: { status: b.status },
      after: { status: "placed", orderRef: ref || null, wasHeld: b.status === "held", confirmedWithRaghav },
    });
  });
}

export async function exportOrdersCsv(user: SessionUser): Promise<string> {
  const rows = await listBuyingDecisions();
  await audit(getDb(), { actor: user, action: "order.exported", entity: "buying_decisions", after: { rows: rows.length } });
  return buyingCsv(rows);
}

export interface HubSpotResult {
  id: number;
  skuId: string;
  ok: boolean;
  dealId?: string;
  error?: string;
}

/**
 * Creates one HubSpot deal per pending buying decision, only when procurement asks.
 * HubSpot documents no idempotency key, so each row is claimed atomically first and keeps its deal id,
 * which means a decision can never create two deals. Held, placed and already-sent rows are skipped.
 */
export async function sendToHubSpot(user: SessionUser, ids?: number[]): Promise<{ sent: number; failed: number; results: HubSpotResult[] }> {
  if (!hubspotConfigured()) throw new HttpError(409, "HubSpot is not connected. Set HUBSPOT_ACCESS_TOKEN for this deployment.");
  const db = getDb();
  const where = ids?.length
    ? and(eq(schema.buyingDecisions.status, "pending"), isNull(schema.buyingDecisions.sinkRef), inArray(schema.buyingDecisions.id, ids))
    : and(eq(schema.buyingDecisions.status, "pending"), isNull(schema.buyingDecisions.sinkRef));
  const rows = await db.select().from(schema.buyingDecisions).where(where).orderBy(schema.buyingDecisions.id);

  const results: HubSpotResult[] = [];
  for (const r of rows) {
    const claimed = await db
      .update(schema.buyingDecisions)
      .set({ sink: "hubspot", sinkRef: "sending" })
      .where(and(eq(schema.buyingDecisions.id, r.id), eq(schema.buyingDecisions.status, "pending"), isNull(schema.buyingDecisions.sinkRef)))
      .returning({ id: schema.buyingDecisions.id });
    if (!claimed.length) continue;
    try {
      const deal = await createDeal(dealPayload({ action: r.action, quantity: r.quantity, skuId: r.skuId, skuName: r.skuName, runId: r.runId }));
      await db.update(schema.buyingDecisions).set({ sinkRef: deal.id }).where(eq(schema.buyingDecisions.id, r.id));
      await audit(db, { actor: user, action: "order.sent_to_hubspot", entity: "buying_decisions", entityId: r.id, after: { dealId: deal.id, sku: r.skuId } });
      results.push({ id: r.id, skuId: r.skuId, ok: true, dealId: deal.id });
    } catch (e) {
      // Release the claim so it can be retried.
      await db.update(schema.buyingDecisions).set({ sink: "csv", sinkRef: null }).where(eq(schema.buyingDecisions.id, r.id));
      const msg = e instanceof HubSpotError ? e.message : "HubSpot call failed.";
      await audit(db, { actor: user, action: "order.hubspot_failed", entity: "buying_decisions", entityId: r.id, after: { error: msg, sku: r.skuId } });
      results.push({ id: r.id, skuId: r.skuId, ok: false, error: msg });
    }
  }
  return { sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
}

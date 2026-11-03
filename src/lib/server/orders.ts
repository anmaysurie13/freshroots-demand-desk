import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buyingCsv, type BuyingDecision } from "../orders/sink";
import { HttpError, type SessionUser } from "./auth";
import { audit } from "./audit";

export async function listBuyingDecisions(): Promise<(BuyingDecision & { placedAt: Date | null; orderRef: string | null; killed?: never })[]> {
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

import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { parseDate } from "../engine/weeks";
import { quarterBounds } from "../kill/logic";
import { HttpError, type SessionUser } from "./auth";
import { audit } from "./audit";
import { evaluateKill2Now } from "./kill";

export interface LossInput {
  periodStart: string;
  periodEnd: string;
  stockoutLoss: number;
  overstockWriteoff: number;
  note?: string;
}

const MAX_RUPEES = 99_999_999_999;

function money(n: unknown, label: string): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_RUPEES) {
    throw new HttpError(400, `${label} must be a number of rupees, 0 or more.`);
  }
  return Math.round(n * 100) / 100;
}

/**
 * Priya's loss entry. The app never computes these figures: she enters them from her own method.
 * Saving the same period again edits it, and the before/after values go to the audit log.
 */
export async function saveLoss(input: LossInput, user: SessionUser) {
  const start = parseDate(input.periodStart);
  const end = parseDate(input.periodEnd);
  if (!start || !end) throw new HttpError(400, "Period start and end must be valid dates.");
  if (end < start) throw new HttpError(400, "Period end cannot be before period start.");
  if (quarterBounds(input.periodStart).label !== quarterBounds(input.periodEnd).label) {
    throw new HttpError(400, "A period cannot cross a quarter. Enter one entry per quarter.");
  }
  const stockout = money(input.stockoutLoss, "Stockout loss");
  const overstock = money(input.overstockWriteoff, "Overstock write-off");
  const note = (input.note ?? "").trim().slice(0, 500) || null;

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.lossEntries)
    .where(and(eq(schema.lossEntries.periodStart, input.periodStart), eq(schema.lossEntries.periodEnd, input.periodEnd)));

  const edited = existing.length > 0;
  const id = await db.transaction(async (tx) => {
    if (edited) {
      const prev = existing[0];
      await tx
        .update(schema.lossEntries)
        .set({ stockoutLoss: String(stockout), overstockWriteoff: String(overstock), note, enteredBy: user.id, enteredAt: new Date() })
        .where(eq(schema.lossEntries.id, prev.id));
      await audit(tx, {
        actor: user,
        action: "loss.edited",
        entity: "loss_entries",
        entityId: prev.id,
        before: { stockout: Number(prev.stockoutLoss), overstock: Number(prev.overstockWriteoff), note: prev.note },
        after: { stockout, overstock, note },
      });
      return prev.id;
    }
    const [row] = await tx
      .insert(schema.lossEntries)
      .values({ periodStart: input.periodStart, periodEnd: input.periodEnd, stockoutLoss: String(stockout), overstockWriteoff: String(overstock), enteredBy: user.id, note })
      .returning({ id: schema.lossEntries.id });
    await audit(tx, {
      actor: user,
      action: "loss.entered",
      entity: "loss_entries",
      entityId: row.id,
      after: { periodStart: input.periodStart, periodEnd: input.periodEnd, stockout, overstock, note },
    });
    return row.id;
  });

  // Kill 2 is evaluated after every loss entry is saved or edited.
  const kill = await evaluateKill2Now(user);
  return { id, edited, kill };
}

export async function listLoss(limit = 50) {
  return getDb().select().from(schema.lossEntries).orderBy(desc(schema.lossEntries.periodStart), desc(schema.lossEntries.id)).limit(limit);
}

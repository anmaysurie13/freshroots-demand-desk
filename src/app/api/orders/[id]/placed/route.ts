import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { markPlaced } from "@/lib/server/orders";

const Body = z.object({ orderRef: z.string().max(60).optional(), confirmedWithRaghav: z.boolean().optional() });

export async function POST(req: Request, ctx: RouteContext<"/api/orders/[id]/placed">) {
  try {
    const user = await requireApi(["procurement"]);
    const { id } = await ctx.params;
    const orderId = Number(id);
    const body = Body.safeParse(await req.json().catch(() => ({})));
    if (!Number.isInteger(orderId) || !body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    await markPlaced(orderId, user, body.data.orderRef ?? "", body.data.confirmedWithRaghav === true);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

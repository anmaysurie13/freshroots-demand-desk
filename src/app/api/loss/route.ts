import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { saveLoss } from "@/lib/server/loss";

const Body = z.object({
  periodStart: z.string().length(10),
  periodEnd: z.string().length(10),
  stockoutLoss: z.number(),
  overstockWriteoff: z.number(),
  note: z.string().max(500).optional(),
});

/** Priya enters the rupee losses. Everyone else gets 403. */
export async function POST(req: Request) {
  try {
    const user = await requireApi(["priya"]);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Fill in the period and both amounts as numbers." }, { status: 400 });
    return Response.json(await saveLoss(body.data, user));
  } catch (e) {
    return jsonError(e);
  }
}

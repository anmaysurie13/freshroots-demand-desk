import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { reviewDecision } from "@/lib/server/review";

const Body = z.object({
  outcome: z.enum(["accepted", "rejected"]),
  finalFlagTypes: z.array(z.string()).max(3).optional(),
  finalAction: z.string().max(20).optional(),
  finalQty: z.number().optional(),
  reasonCode: z.string().max(60).optional(),
  reasonText: z.string().max(500).optional(),
});

/** Only raghav can review; admin is an audited break-glass. Procurement, Priya, Deepa and the CEO get 403. */
export async function POST(req: Request, ctx: RouteContext<"/api/decisions/[id]/review">) {
  try {
    const user = await requireApi(["raghav", "admin"]);
    const { id } = await ctx.params;
    const decisionId = Number(id);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(decisionId) || !body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    return Response.json(await reviewDecision(decisionId, user, body.data));
  } catch (e) {
    return jsonError(e);
  }
}

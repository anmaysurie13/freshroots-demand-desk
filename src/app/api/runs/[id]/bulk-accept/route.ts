import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { bulkAccept } from "@/lib/server/review";

const Body = z.object({ decisionIds: z.array(z.number().int()).min(1).max(500) });

export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/bulk-accept">) {
  try {
    const user = await requireApi(["raghav", "admin"]);
    const { id } = await ctx.params;
    const runId = Number(id);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(runId) || !body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    return Response.json(await bulkAccept(runId, body.data.decisionIds, user));
  } catch (e) {
    return jsonError(e);
  }
}

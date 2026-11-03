import { jsonError, requireApi } from "@/lib/server/auth";
import { runAiStep } from "@/lib/server/runs";

// The AI step makes one model call per flag, a few at a time.
export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/ai">) {
  try {
    const user = await requireApi(["raghav"]);
    const { id } = await ctx.params;
    const runId = Number(id);
    if (!Number.isInteger(runId)) return Response.json({ error: "Bad run id." }, { status: 400 });
    return Response.json(await runAiStep(runId, user));
  } catch (e) {
    return jsonError(e);
  }
}

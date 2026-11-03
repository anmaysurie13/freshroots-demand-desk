import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { rearm } from "@/lib/server/kill";

const Body = z.object({ switch: z.union([z.literal(1), z.literal(2)]), reason: z.string().max(1000), confirmRefire: z.boolean().optional() });

/** Only deepa or the CEO can re-arm, with a written reason. Everyone else gets 403. */
export async function POST(req: Request) {
  try {
    const user = await requireApi(["deepa", "ceo"]);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    return Response.json(await rearm(body.data.switch, user, body.data.reason, body.data.confirmRefire === true));
  } catch (e) {
    return jsonError(e);
  }
}

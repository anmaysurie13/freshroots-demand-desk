import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { acknowledgeAlert } from "@/lib/server/kill";

const Body = z.object({ eventId: z.number().int() });

/** Deepa's weekly "I reviewed this alert". */
export async function POST(req: Request) {
  try {
    const user = await requireApi(["deepa", "ceo"]);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    await acknowledgeAlert(body.data.eventId, user);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

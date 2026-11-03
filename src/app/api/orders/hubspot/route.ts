import { z } from "zod";
import { jsonError, requireApi } from "@/lib/server/auth";
import { sendToHubSpot } from "@/lib/server/orders";

const Body = z.object({ ids: z.array(z.number().int()).max(500).optional() });

/** Procurement sends pending buying decisions to HubSpot as deals. Never automatic. */
export async function POST(req: Request) {
  try {
    const user = await requireApi(["procurement"]);
    const body = Body.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    return Response.json(await sendToHubSpot(user, body.data.ids));
  } catch (e) {
    return jsonError(e);
  }
}

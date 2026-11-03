import { z } from "zod";
import { getDb } from "@/db";
import { ROLES } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { HOME_BY_ROLE, enterAsRole, jsonError } from "@/lib/server/auth";

const Body = z.object({ role: z.enum(ROLES) });

/** Open-access demo: choose a role, no password. Refused unless OPEN_ACCESS_DEMO is "true". */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Choose one of the listed roles." }, { status: 400 });
    const user = await enterAsRole(body.data.role);
    await audit(getDb(), { actor: user, action: "auth.role_selected", entity: "users", entityId: user.id, after: { role: user.role } });
    return Response.json({ redirect: HOME_BY_ROLE[user.role] });
  } catch (e) {
    return jsonError(e);
  }
}

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/server/audit";
import { HttpError, jsonError, requireApi } from "@/lib/server/auth";

const Body = z.object({ active: z.boolean() });

export async function PATCH(req: Request, ctx: RouteContext<"/api/users/[id]">) {
  try {
    const admin = await requireApi(["admin"]);
    const { id } = await ctx.params;
    const userId = Number(id);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!Number.isInteger(userId) || !body.success) return Response.json({ error: "Bad request." }, { status: 400 });
    if (userId === admin.id && !body.data.active) throw new HttpError(400, "You cannot deactivate your own account.");
    const db = getDb();
    const [u] = await db.update(schema.users).set({ active: body.data.active }).where(eq(schema.users.id, userId)).returning({ id: schema.users.id, email: schema.users.email });
    if (!u) throw new HttpError(404, "User not found.");
    await audit(db, { actor: admin, action: body.data.active ? "user.activated" : "user.deactivated", entity: "users", entityId: u.id, after: { email: u.email } });
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

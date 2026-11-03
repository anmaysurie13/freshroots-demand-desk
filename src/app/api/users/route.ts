import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { ROLES } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { jsonError, requireApi } from "@/lib/server/auth";

const Body = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(200),
  role: z.enum(ROLES),
  password: z.string().min(12).max(200),
});

export async function POST(req: Request) {
  try {
    const admin = await requireApi(["admin"]);
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Name, a valid email, a role and a password of 12+ characters are needed." }, { status: 400 });
    const b = body.data;
    const db = getDb();
    try {
      const [u] = await db
        .insert(schema.users)
        .values({ name: b.name.trim(), email: b.email.trim().toLowerCase(), role: b.role, passwordHash: await bcrypt.hash(b.password, 12) })
        .returning({ id: schema.users.id });
      await audit(db, { actor: admin, action: "user.created", entity: "users", entityId: u.id, after: { email: b.email.toLowerCase(), role: b.role } });
      return Response.json({ id: u.id });
    } catch {
      return Response.json({ error: "That email already has an account." }, { status: 409 });
    }
  } catch (e) {
    return jsonError(e);
  }
}

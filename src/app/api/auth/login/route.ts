import { z } from "zod";
import { HOME_BY_ROLE, attemptLogin, jsonError, startSession } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { getDb } from "@/db";

const Body = z.object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter your email and password." }, { status: 400 });
    const res = await attemptLogin(parsed.data.email, parsed.data.password);
    if (!res.ok) return Response.json({ error: res.message }, { status: res.status });
    await startSession(res.user.id);
    await audit(getDb(), { actor: res.user, action: "auth.login", entity: "users", entityId: res.user.id });
    return Response.json({ redirect: HOME_BY_ROLE[res.user.role] });
  } catch (e) {
    return jsonError(e);
  }
}

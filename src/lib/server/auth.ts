import { and, asc, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, schema } from "@/db";
import type { Role } from "@/db/schema";

const COOKIE = "fr_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/**
 * There are no passwords. People pick a role, and that is only allowed while OPEN_ACCESS_DEMO is "true".
 * With the switch off nobody can start a session, so open access is always a deliberate setting.
 */
export function openAccessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPEN_ACCESS_DEMO === "true";
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

async function startSession(userId: number): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, re-read from the database on every request so deactivation takes effect at once. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let uid: number;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    uid = Number(payload.uid);
  } catch {
    return null;
  }
  if (!Number.isInteger(uid)) return null;
  const [u] = await getDb().select().from(schema.users).where(eq(schema.users.id, uid));
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
});

export const HOME_BY_ROLE: Record<Role, string> = {
  raghav: "/review",
  procurement: "/orders",
  priya: "/dashboard",
  deepa: "/dashboard",
  ceo: "/dashboard",
  admin: "/dashboard",
};

/** For pages: redirect when signed out, and send people without the role to their own home. */
export async function requirePage(roles?: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect(HOME_BY_ROLE[u.role]);
  return u;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** For route handlers: server-side role check on every call. Throws 401 or 403. */
export async function requireApi(roles?: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new HttpError(401, "Choose a role to continue.");
  if (roles && !roles.includes(u.role)) throw new HttpError(403, "Your role cannot do this.");
  return u;
}

export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status });
  console.error("Unhandled error:", e instanceof Error ? e.message : "unknown");
  return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
}

/** Starts a session as the first active account holding the role. Refused unless open access is switched on. */
export async function enterAsRole(role: Role): Promise<SessionUser> {
  if (!openAccessEnabled()) throw new HttpError(403, "Open access is switched off for this deployment.");
  const [u] = await getDb()
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.role, role), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.id))
    .limit(1);
  if (!u) throw new HttpError(404, "There is no active account for that role.");
  await startSession(u.id);
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

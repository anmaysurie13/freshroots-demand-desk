import bcrypt from "bcryptjs";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, schema } from "@/db";
import type { Role } from "@/db/schema";
import { rulesConfig } from "../config";

const COOKIE = "fr_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

export async function startSession(userId: number): Promise<void> {
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
  if (!u) throw new HttpError(401, "Sign in required.");
  if (roles && !roles.includes(u.role)) throw new HttpError(403, "Your role cannot do this.");
  return u;
}

export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status });
  console.error("Unhandled error:", e instanceof Error ? e.message : "unknown");
  return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  return (dummy ??= bcrypt.hash("not-a-real-password", 12));
}

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; status: number; message: string };

/** Email + password sign-in with a per-email and per-IP failed-attempt limit inside a rolling window. */
export async function attemptLogin(emailRaw: string, password: string): Promise<LoginResult> {
  const db = getDb();
  const email = emailRaw.trim().toLowerCase();
  const ip = await clientIp();
  const lim = rulesConfig.login;
  const since = new Date(Date.now() - lim.windowMinutes * 60_000);

  const [byEmail] = await db
    .select({ n: count() })
    .from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.email, email), eq(schema.loginAttempts.success, false), gte(schema.loginAttempts.at, since)));
  const [byIp] = await db
    .select({ n: count() })
    .from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.ip, ip), eq(schema.loginAttempts.success, false), gte(schema.loginAttempts.at, since)));
  if (byEmail.n >= lim.maxFailedPerEmail || byIp.n >= lim.maxFailedPerIp) {
    return { ok: false, status: 429, message: `Too many failed attempts. Try again in ${lim.windowMinutes} minutes.` };
  }

  const [u] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, email));
  // Compare against a dummy hash when the user is unknown so timing does not reveal which emails exist.
  const hash = u?.passwordHash ?? (await dummyHash());
  const match = await bcrypt.compare(password, hash);
  const ok = !!u && u.active && match;
  await db.insert(schema.loginAttempts).values({ email, ip, success: ok });
  if (!ok) return { ok: false, status: 401, message: "Email or password is not correct." };
  return { ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role } };
}

import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** No secrets in the output: only whether the app, database and AI configuration are present. */
export async function GET() {
  let db = false;
  try {
    await getDb().execute(sql`select 1`);
    db = true;
  } catch {
    db = false;
  }
  const ai = process.env.AI_PROVIDER === "mock" || !!(process.env.AI_PROVIDER && process.env.AI_API_KEY && process.env.AI_MODEL);
  return Response.json({ ok: db, db, aiConfigured: ai, aiProvider: process.env.AI_PROVIDER ?? null }, { status: db ? 200 : 503 });
}

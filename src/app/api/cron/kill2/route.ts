import crypto from "node:crypto";
import { evaluateKill2Now } from "@/lib/server/kill";

/** Daily Kill 2 check (Vercel Cron). Rejects calls without the CRON_SECRET bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = !!secret && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const r = await evaluateKill2Now(null);
    return Response.json(r);
  } catch {
    return Response.json({ error: "Evaluation failed." }, { status: 500 });
  }
}

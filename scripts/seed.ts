// Idempotent seed: the kill-state row and one account per role.
// New accounts get a random password written to .seed-credentials.txt (git-ignored). Nothing is printed.
// Usage: npx tsx scripts/seed.ts
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";

dotenv.config({ path: ".env.local", quiet: true });

const ACCOUNTS = [
  { name: "Raghav Kulkarni", email: "raghav@freshroots.example", role: "raghav" },
  { name: "Procurement Desk", email: "procurement@freshroots.example", role: "procurement" },
  { name: "Priya Sharma", email: "priya@freshroots.example", role: "priya" },
  { name: "Deepa Nair", email: "deepa@freshroots.example", role: "deepa" },
  { name: "CEO", email: "ceo@freshroots.example", role: "ceo" },
  { name: "Admin", email: "admin@freshroots.example", role: "admin" },
] as const;

function randomPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join("");
}

async function main() {
  const { getDb, schema } = await import("../src/db");
  const db = getDb();

  await db.insert(schema.killState).values({ id: 1 }).onConflictDoNothing();

  const lines: string[] = [];
  for (const a of ACCOUNTS) {
    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(sql`lower(${schema.users.email})`, a.email));
    if (existing.length) continue;
    const pw = randomPassword();
    await db.insert(schema.users).values({ ...a, passwordHash: await bcrypt.hash(pw, 12) });
    lines.push(`${a.role.padEnd(12)} ${a.email.padEnd(34)} ${pw}`);
  }
  if (lines.length) {
    fs.appendFileSync(".seed-credentials.txt", lines.join("\n") + "\n");
    console.log(`Created ${lines.length} account(s). Passwords are in .seed-credentials.txt (git-ignored).`);
  } else {
    console.log("All accounts already exist. Nothing changed.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

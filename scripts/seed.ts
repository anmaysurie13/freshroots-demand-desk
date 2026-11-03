// Idempotent seed: the kill-state row and one account per role. There are no passwords.
// Usage: npx tsx scripts/seed.ts
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

async function main() {
  const { getDb, schema } = await import("../src/db");
  const db = getDb();

  await db.insert(schema.killState).values({ id: 1 }).onConflictDoNothing();

  let created = 0;
  for (const a of ACCOUNTS) {
    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(sql`lower(${schema.users.email})`, a.email));
    if (existing.length) continue;
    await db.insert(schema.users).values(a);
    created++;
  }
  console.log(created ? `Created ${created} account(s).` : "All accounts already exist. Nothing changed.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

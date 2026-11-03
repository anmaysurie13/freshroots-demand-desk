import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { getDb, schema } from "@/db";
import type { Role } from "@/db/schema";

type Executor = Tx | ReturnType<typeof getDb>;

/**
 * Email goes through one adapter. Only the `console` provider exists: it writes each message to the
 * outbox table (visible on the Kill page) and logs the subject. No real mail is sent until a provider is added.
 */
export async function queueEmail(ex: Executor, roles: Role[], subject: string, body: string): Promise<number> {
  const recipients = await ex
    .select({ email: schema.users.email, role: schema.users.role })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, roles)));
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  if (recipients.length) {
    await ex.insert(schema.emailOutbox).values(
      recipients.map((r) => ({ toRole: r.role, toEmail: r.email, subject, body, provider, status: "logged" })),
    );
  }
  console.log(`[email:${provider}] queued "${subject}" for ${recipients.length} recipient(s)`);
  return recipients.length;
}

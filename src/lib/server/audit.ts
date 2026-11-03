import type { Tx } from "@/db";
import { getDb, schema } from "@/db";
import type { SessionUser } from "./auth";

type Executor = Tx | ReturnType<typeof getDb>;

export interface AuditEntry {
  actor: SessionUser | null;
  /** Used when there is no signed-in user, e.g. the scheduled job. */
  systemLabel?: string;
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only. Never updated or deleted. Never put secrets or full uploaded files in before/after. */
export async function audit(ex: Executor, e: AuditEntry): Promise<void> {
  await ex.insert(schema.auditLog).values({
    actorId: e.actor?.id ?? null,
    actorLabel: e.actor ? `${e.actor.name} (${e.actor.role})` : (e.systemLabel ?? "system"),
    action: e.action,
    entity: e.entity,
    entityId: e.entityId === undefined || e.entityId === null ? null : String(e.entityId),
    beforeJson: (e.before ?? null) as never,
    afterJson: (e.after ?? null) as never,
  });
}

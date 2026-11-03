import { PageHead, Pill } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { requirePage } from "@/lib/server/auth";
import { getAudit } from "@/lib/server/queries";

export const metadata = { title: "Audit log · Demand Desk" };

const ENTITIES = ["runs", "reviews", "buying_decisions", "loss_entries", "kill_state", "kill_events", "users", "dashboard"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; actor?: string }> }) {
  await requirePage(["deepa", "admin"]);
  const f = await searchParams;
  const rows = await getAudit({ action: f.action?.trim() || undefined, entity: f.entity || undefined, actor: f.actor?.trim() || undefined, limit: 200 });

  return (
    <>
      <PageHead title="Audit log" sub="Every upload, run, review, order, loss entry, kill event and re-arm, with who and when. Append-only: nothing here is edited or deleted." />
      <form method="get" className="card" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end" }}>
        <div className="field">
          <label className="label" htmlFor="a">Action contains</label>
          <input id="a" name="action" className="input" defaultValue={f.action ?? ""} placeholder="review, kill1, order..." />
        </div>
        <div className="field">
          <label className="label" htmlFor="e">Entity</label>
          <select id="e" name="entity" className="select" defaultValue={f.entity ?? ""}>
            <option value="">All</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="u">Actor contains</label>
          <input id="u" name="actor" className="input" defaultValue={f.actor ?? ""} placeholder="raghav, system..." />
        </div>
        <button className="btn btn-primary" type="submit">Filter</button>
      </form>

      <section className="card">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 28 }}>No entries match.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.createdAt)}</td>
                  <td>{r.actorLabel}</td>
                  <td><Pill tone={r.action.includes("kill") ? "clay" : r.action.includes("break_glass") ? "amber" : "slate"}>{r.action}</Pill></td>
                  <td className="num">{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</td>
                  <td className="num faint" style={{ maxWidth: 460, fontSize: 12, wordBreak: "break-word" }}>
                    {r.afterJson ? JSON.stringify(r.afterJson).slice(0, 220) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="faint" style={{ fontSize: 12 }}>Showing the latest {rows.length} matching entries (limit 200).</p>
    </>
  );
}

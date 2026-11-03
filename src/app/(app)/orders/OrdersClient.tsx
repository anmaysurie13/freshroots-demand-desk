"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Pill } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { REASON_LABELS } from "@/lib/review-rules";

interface Row {
  id: number;
  runId: number;
  skuId: string;
  skuName: string;
  action: string;
  quantity: number;
  source: string;
  reasonCode: string | null;
  status: string;
  asOfDate: string;
  createdAt: string;
  placedAt: string | null;
  orderRef: string | null;
}

function ageDays(asOf: string, at: string | null): number {
  const from = new Date(asOf + "T00:00:00Z").getTime();
  const to = at ? new Date(at).getTime() : Date.now();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function OrdersClient({ rows, canPlace, killed }: { rows: Row[]; canPlace: boolean; killed: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "placed" | "all">("open");
  const [refs, setRefs] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = rows.filter((r) => r.status !== "placed");
  const held = rows.filter((r) => r.status === "held");
  const shown = useMemo(() => (tab === "open" ? open : tab === "placed" ? rows.filter((r) => r.status === "placed") : rows), [rows, tab, open]);

  async function place(r: Row) {
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${r.id}/placed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderRef: refs[r.id] ?? "", confirmedWithRaghav: confirm[r.id] === true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not mark as placed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark as placed.");
    }
    setBusy(null);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {held.length > 0 && (
        <div className="note note-clay" role="alert">
          <strong>Automation stopped. Confirm with Raghav before ordering.</strong> {held.length} item{held.length > 1 ? "s are" : " is"} held. They are not cancelled.
        </div>
      )}
      {error && <div className="note note-clay" role="alert">{error}</div>}

      <div style={{ display: "flex", gap: 8 }} role="tablist" aria-label="Filter orders">
        {(
          [
            ["open", `To place (${open.length})`],
            ["placed", `Placed (${rows.length - open.length})`],
            ["all", `All (${rows.length})`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Decision</th>
                <th>Source</th>
                <th>Status</th>
                <th>Run</th>
                <th>Data age</th>
                {canPlace && <th>Place</th>}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={canPlace ? 7 : 6} className="muted" style={{ textAlign: "center", padding: 28 }}>
                    Nothing here.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="num" style={{ fontWeight: 600 }}>{r.skuId}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{r.skuName}</div>
                  </td>
                  <td>
                    {r.action === "REORDER" ? (
                      <span className="num" style={{ fontWeight: 600 }}>Reorder {r.quantity.toLocaleString("en-IN")}</span>
                    ) : (
                      <div>
                        <span style={{ fontWeight: 600 }}>Hold the next order</span>
                        <div className="faint" style={{ fontSize: 12 }}>Not a cancellation of an existing order</div>
                      </div>
                    )}
                  </td>
                  <td>
                    {r.source === "ai_accepted" ? <Pill tone="teal">AI accepted</Pill> : <Pill tone="amber">Raghav changed</Pill>}
                    {r.reasonCode && <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{REASON_LABELS[r.reasonCode as keyof typeof REASON_LABELS] ?? r.reasonCode}</div>}
                  </td>
                  <td>
                    <Pill tone={r.status === "placed" ? "slate" : r.status === "held" ? "clay" : "amber"}>{r.status}</Pill>
                    {r.orderRef && <div className="faint num" style={{ fontSize: 12, marginTop: 4 }}>{r.orderRef}</div>}
                    {r.placedAt && <div className="faint" style={{ fontSize: 12 }}>{fmtDateTime(r.placedAt)}</div>}
                  </td>
                  <td className="num">#{r.runId}<div className="faint" style={{ fontSize: 12 }}>{r.asOfDate}</div></td>
                  <td className="num">{ageDays(r.asOfDate, r.placedAt)} d</td>
                  {canPlace && (
                    <td style={{ minWidth: 240 }}>
                      {r.status === "placed" ? null : (
                        <div style={{ display: "grid", gap: 8 }}>
                          <input className="input" placeholder="Order reference (optional)" maxLength={60} value={refs[r.id] ?? ""} onChange={(e) => setRefs((p) => ({ ...p, [r.id]: e.target.value }))} aria-label={`Order reference for ${r.skuId}`} />
                          {r.status === "held" && (
                            <label className="checkrow" style={{ minHeight: 0 }}>
                              <input type="checkbox" checked={confirm[r.id] === true} onChange={(e) => setConfirm((p) => ({ ...p, [r.id]: e.target.checked }))} />
                              <span style={{ fontSize: 12.5 }}>I confirmed with Raghav</span>
                            </label>
                          )}
                          <button className="btn btn-sm btn-primary" disabled={busy === r.id || (r.status === "held" && !confirm[r.id])} onClick={() => place(r)}>
                            {busy === r.id ? "Saving..." : "Mark placed"}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {killed && !held.length && <div className="faint" style={{ fontSize: 12 }}>Automation is stopped. Items already placed are unaffected.</div>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

function quarterStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const sm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(sm).padStart(2, "0")}-01`;
}

export function LossForm({ today, quarterLabel }: { today: string; quarterLabel: string }) {
  const router = useRouter();
  const [start, setStart] = useState(quarterStart(today));
  const [end, setEnd] = useState(today);
  const [stockout, setStockout] = useState("");
  const [overstock, setOverstock] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/loss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart: start, periodEnd: end, stockoutLoss: Number(stockout || 0), overstockWriteoff: Number(overstock || 0), note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save.");
      const s = j.kill?.state as string;
      setMsg({
        kind: "ok",
        text: `${j.edited ? "Entry updated" : "Entry saved"}. Kill 2 is now ${s === "green" ? "green" : s}.${s === "alert" ? " An alert email was queued." : ""}${s === "killed" ? " Automation has stopped." : ""}`,
      });
      setStockout("");
      setOverstock("");
      setNote("");
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Could not save." });
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">Enter loss</div>
        <span className="faint" style={{ fontSize: 12 }}>{quarterLabel}</span>
      </div>
      <form className="card-body" onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="ps">Period start</label>
            <input id="ps" className="input" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pe">Period end</label>
            <input id="pe" className="input" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="so">Stockout lost sales (Rs)</label>
          <input id="so" className="input num" type="number" min={0} step="0.01" inputMode="decimal" required value={stockout} onChange={(e) => setStockout(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="ov">Overstock write-off (Rs)</label>
          <input id="ov" className="input num" type="number" min={0} step="0.01" inputMode="decimal" required value={overstock} onChange={(e) => setOverstock(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nt">Note (optional)</label>
          <input id="nt" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          Saving a period that already exists edits it, and the old values go to the audit log. The app never computes these figures.
        </p>
        {msg && <div className={`note ${msg.kind === "ok" ? "note-lime" : "note-clay"}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Save entry"}</button>
      </form>
    </section>
  );
}

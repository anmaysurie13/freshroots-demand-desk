"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtDateTime, lakh } from "@/lib/format";

interface Props {
  canAct: boolean;
  kill1Killed: boolean;
  kill2Killed: boolean;
  kill2Total: number;
  killAbove: number;
  pendingAlert: { id: number; at: string } | null;
}

export function KillClient({ canAct, kill1Killed, kill2Killed, kill2Total, killAbove, pendingAlert }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function ack() {
    if (!pendingAlert) return;
    setBusy("ack");
    setMsg(null);
    try {
      const res = await fetch("/api/kill/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: pendingAlert.id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not acknowledge.");
      setMsg({ kind: "ok", text: "Alert acknowledged." });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
    }
    setBusy(null);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {msg && <div className={`note ${msg.kind === "ok" ? "note-lime" : "note-clay"}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</div>}

      {pendingAlert && (
        <section className="card" style={{ padding: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", borderColor: "rgba(241,184,74,0.5)" }}>
          <div>
            <div className="card-title">Weekly alert acknowledgement</div>
            <div className="muted">Kill 2 raised an alert on {fmtDateTime(pendingAlert.at)}. Deepa reviews it weekly and confirms here.</div>
          </div>
          {canAct && <button className="btn btn-primary" onClick={ack} disabled={busy !== null}>{busy === "ack" ? "Saving..." : "I reviewed this week's alert"}</button>}
        </section>
      )}

      {(kill1Killed || kill2Killed) && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {kill1Killed && (
            <RearmCard
              sw={1}
              title="Re-arm Kill 1"
              canAct={canAct}
              warn="Counting restarts from zero. Past reviews are kept."
              onDone={(t) => { setMsg({ kind: "ok", text: t }); router.refresh(); }}
              onError={(t) => setMsg({ kind: "err", text: t })}
            />
          )}
          {kill2Killed && (
            <RearmCard
              sw={2}
              title="Re-arm Kill 2"
              canAct={canAct}
              warn={
                kill2Total > killAbove
                  ? `Quarter-to-date loss is ${lakh(kill2Total)}, still above the kill level. Kill 2 will fire again straight away unless the loss entries change.`
                  : "Loss entries are kept. Kill 2 re-evaluates immediately after the re-arm."
              }
              needsConfirm={kill2Total > killAbove}
              onDone={(t) => { setMsg({ kind: "ok", text: t }); router.refresh(); }}
              onError={(t) => setMsg({ kind: "err", text: t })}
            />
          )}
        </div>
      )}
      {!canAct && (kill1Killed || kill2Killed) && <p className="faint" style={{ margin: 0, fontSize: 13 }}>Only Deepa or the CEO can re-arm a kill switch.</p>}
    </div>
  );
}

function RearmCard({ sw, title, canAct, warn, needsConfirm, onDone, onError }: { sw: 1 | 2; title: string; canAct: boolean; warn: string; needsConfirm?: boolean; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 20 && (!needsConfirm || confirm);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch("/api/kill/rearm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ switch: sw, reason, confirmRefire: confirm }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not re-arm.");
      onDone(j.refired ? `Kill ${sw} was re-armed and fired again because the loss is still above the kill level.` : `Kill ${sw} re-armed.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not re-arm.");
    }
    setBusy(false);
  }

  return (
    <section className="card" style={{ padding: 18, display: "grid", gap: 12, borderColor: "rgba(224,152,138,0.4)" }}>
      <div className="card-title">{title}</div>
      <div className={`note ${needsConfirm ? "note-clay" : ""}`}>{warn}</div>
      {canAct ? (
        <>
          <div className="field">
            <label className="label" htmlFor={`r${sw}`}>Written reason (at least 20 characters)</label>
            <textarea id={`r${sw}`} className="textarea" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            <span className="faint num" style={{ fontSize: 12 }}>{reason.trim().length} / 20</span>
          </div>
          {needsConfirm && (
            <label className="checkrow">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              <span>I understand it will fire again straight away.</span>
            </label>
          )}
          <button className="btn btn-danger" disabled={!ok || busy} onClick={go}>{busy ? "Re-arming..." : `Re-arm Kill ${sw}`}</button>
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Your role cannot re-arm.</p>
      )}
    </section>
  );
}

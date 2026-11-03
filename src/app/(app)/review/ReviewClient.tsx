"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconCheck, IconX } from "@/components/icons";
import { CoverBar, FlagPill, Pill, actionText } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { FINAL_ACTIONS, FLAG_TYPES, REASON_CODES, REASON_LABELS, checkReview, type ReviewRequest } from "@/lib/review-rules";

interface Item {
  decisionId: number;
  skuId: string;
  skuName: string;
  perishability: string;
  flagTypes: string[];
  coverWeeks: number | null;
  minCover: number;
  maxCover: number;
  unitsOnHand: number;
  demandRatio: number;
  uom: string;
  ruleAction: string;
  ruleQty: number;
  aiAction: string;
  aiQty: number;
  explanation: string;
  confidence: string | null;
  needsJudgment: boolean;
  judgmentNote: string | null;
  judgmentReasons: { code: string; text: string }[];
  isFallback: boolean;
  invalidReasons: string[];
  status: string;
  review: null | {
    outcome: string;
    finalAction: string;
    finalQty: number;
    finalFlagTypes: string[];
    reasonCode: string | null;
    reasonText: string | null;
    reviewedAt: string;
    reviewerName: string;
    breakGlass: boolean;
  };
}

interface Data {
  run: { id: number; status: string; createdAt: string; asOfDate: string; rulesVersion: string; lastCompleteWeek: string; isFestival: boolean; evaluatedSkus: number };
  isSample: boolean;
  items: Item[];
  counts: { flags: number; decided: number; reviewed: number; accepted: number; rejected: number; voided: number; fallback: number; pending: number };
  fallbackPct: number;
  skipped: { skuId: string; skuName: string; reason: string }[];
}

export function ReviewClient({ data, role, killed }: { data: Data; role: string; killed: boolean }) {
  const router = useRouter();
  const { run, items, counts } = data;
  const canReview = (role === "raghav" || role === "admin") && !killed && run.status === "in_review";
  const [show, setShow] = useState<"pending" | "all">(counts.pending > 0 ? "pending" : "all");
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const visible = useMemo(() => (show === "pending" ? items.filter((i) => i.status === "pending_review") : items), [items, show]);
  const bulkable = items.filter((i) => i.status === "pending_review" && !i.needsJudgment && !i.isFallback);
  const reviewedPct = counts.decided ? Math.round(((counts.reviewed + counts.voided) / counts.decided) * 100) : 0;

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "Request failed.");
    return j;
  }

  async function accept(i: Item) {
    setBusyId(i.decisionId);
    setError(null);
    try {
      await post(`/api/decisions/${i.decisionId}/review`, { outcome: "accepted" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
    setBusyId(null);
  }

  async function runAi() {
    setAiBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/ai`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The AI step failed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI step failed.");
    }
    setAiBusy(false);
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 className="h1" style={{ margin: 0 }}>Review</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Run <span className="num">#{run.id}</span> · data as of <span className="num">{run.asOfDate}</span> (week <span className="num">{run.lastCompleteWeek}</span>) · rules <span className="num">v{run.rulesVersion}</span>
            {run.isFestival && <> · festival uplift on</>}
            {data.isSample && <> · <Pill tone="amber">sample data</Pill></>}
          </p>
        </div>
        {canReview && bulkable.length > 0 && (
          <button className="btn" onClick={() => setBulkOpen(true)}>
            Bulk accept ({bulkable.length})
          </button>
        )}
      </div>

      {killed && (
        <div className="note note-clay" style={{ marginBottom: 16 }} role="alert">
          Automation stopped. Unreviewed AI decisions were voided and cannot be reviewed.
        </div>
      )}
      {!killed && !canReview && run.status === "in_review" && (
        <div className="note" style={{ marginBottom: 16 }}>
          You are viewing this read-only. Only Raghav reviews decisions.
        </div>
      )}
      {data.fallbackPct > 30 && (
        <div className="note note-amber" style={{ marginBottom: 16 }} role="alert">
          <strong>{Math.round(data.fallbackPct)}% of this run&apos;s decisions used the rule-engine fallback.</strong> The AI step had trouble. Raghav and Deepa should check before relying on the explanations.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Stat label="To review" value={counts.pending} tone={counts.pending ? "amber" : undefined} />
        <Stat label="Accepted" value={counts.accepted} tone="lime" />
        <Stat label="Rejected" value={counts.rejected} tone="clay" />
        <Stat label="AI fallback" value={counts.fallback} />
      </div>

      <div className="card" style={{ padding: "14px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontWeight: 600 }}>
          <span>
            <span className="num">{counts.reviewed}</span> of <span className="num">{counts.decided}</span> reviewed
          </span>
          <span className="faint num">{reviewedPct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }} role="progressbar" aria-valuenow={reviewedPct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${reviewedPct}%`, height: "100%", background: "var(--teal)", transition: "width 300ms ease" }} />
        </div>
      </div>

      {error && <div className="note note-clay" style={{ marginBottom: 16 }} role="alert">{error}</div>}

      {run.status === "flagged" && (
        <div className="card" style={{ padding: 22, marginBottom: 20, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 600 }}>{counts.flags} flags are waiting for the AI step.</div>
            <div className="muted">The AI explains each flag. If it fails, the rule engine&apos;s own decision is used and badged.</div>
          </div>
          {role === "raghav" && !killed && (
            <button className="btn btn-primary" onClick={runAi} disabled={aiBusy}>{aiBusy ? "Running AI step..." : "Run AI step"}</button>
          )}
        </div>
      )}

      {run.status === "completed" && counts.decided === 0 && (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>No SKU was flagged in this run.</div>
          <div className="muted">All {run.evaluatedSkus} evaluated SKUs are inside their cover bands and demand is steady.</div>
        </div>
      )}

      {counts.decided > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }} role="tablist" aria-label="Filter decisions">
          <button role="tab" aria-selected={show === "pending"} className={`btn btn-sm ${show === "pending" ? "btn-primary" : "btn-ghost"}`} onClick={() => setShow("pending")}>
            To review ({counts.pending})
          </button>
          <button role="tab" aria-selected={show === "all"} className={`btn btn-sm ${show === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setShow("all")}>
            All ({counts.decided})
          </button>
        </div>
      )}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
        {visible.length === 0 && counts.decided > 0 && (
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ fontWeight: 600 }}>Everything in this run is reviewed.</div>
            <div className="muted">
              Accepted and changed decisions are now buying decisions. <Link href="/orders">Open Orders</Link>
            </div>
          </div>
        )}
        {visible.map((i) => (
          <article key={i.decisionId} className="card" style={{ borderColor: i.needsJudgment && i.status === "pending_review" ? "rgba(241,184,74,0.5)" : undefined }}>
            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <span className="num" style={{ fontWeight: 600 }}>{i.skuId}</span>
                  <span style={{ marginLeft: 10, fontWeight: 600 }}>{i.skuName}</span>
                  {i.perishability === "High" && <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>perishable</span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {i.needsJudgment && <Pill tone="judge">Needs judgment</Pill>}
                  {i.isFallback && <Pill tone="slate">AI unavailable: rule-engine fallback</Pill>}
                  {i.status === "voided_by_kill" && <Pill tone="clay">Voided by kill switch</Pill>}
                  {i.flagTypes.map((f) => <FlagPill key={f} type={f} />)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 18 }} className="review-cols">
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="eyebrow">Cover against allowed band</div>
                  <CoverBar cover={i.coverWeeks} min={i.minCover} max={i.maxCover} />
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    <span className="num">{i.coverWeeks === null ? "unbounded" : i.coverWeeks.toFixed(2)}</span> weeks · band <span className="num">{i.minCover}-{i.maxCover}</span> · on hand <span className="num">{i.unitsOnHand.toLocaleString("en-IN")}</span> · demand ratio <span className="num">{i.demandRatio.toFixed(2)}</span>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="well">
                    <div className="eyebrow">{i.status === "pending_review" ? "AI decision, pending your review" : "AI decision"}</div>
                    <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, letterSpacing: "-0.01em" }} className="num">
                      {actionText(i.aiAction, i.aiQty, i.uom)}
                    </div>
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.55 }}>{i.explanation}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {i.confidence && <Pill tone={i.confidence === "HIGH" ? "lime" : i.confidence === "MEDIUM" ? "teal" : "amber"}>{i.confidence.toLowerCase()} confidence</Pill>}
                    {i.isFallback && i.invalidReasons[0] && <span className="faint" style={{ fontSize: 12 }}>Reason: {i.invalidReasons[0]}</span>}
                  </div>
                  {i.needsJudgment && (
                    <div className="note note-amber">
                      <div>
                        <strong>Why this needs your judgment: </strong>
                        {i.judgmentReasons.map((r) => r.text).join(" ") || i.judgmentNote}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {i.review ? (
                <div className={`note ${i.review.outcome === "accepted" ? "note-lime" : "note-clay"}`}>
                  <div>
                    <strong>{i.review.outcome === "accepted" ? "Accepted" : "Rejected and changed"}</strong> by {i.review.reviewerName}
                    {i.review.breakGlass && " (admin break-glass)"} · {fmtDateTime(i.review.reviewedAt)}
                    <div className="num" style={{ marginTop: 2 }}>
                      Final: {actionText(i.review.finalAction, i.review.finalQty, i.uom)}
                      {i.review.reasonCode && <> · {REASON_LABELS[i.review.reasonCode as keyof typeof REASON_LABELS] ?? i.review.reasonCode}</>}
                    </div>
                    {i.review.reasonText && <div>{i.review.reasonText}</div>}
                  </div>
                </div>
              ) : canReview && i.status === "pending_review" ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" disabled={busyId === i.decisionId} onClick={() => accept(i)}>
                    <IconCheck /> {busyId === i.decisionId ? "Saving..." : "Accept"}
                  </button>
                  <button className="btn" disabled={busyId === i.decisionId} onClick={() => setRejecting(i)}>
                    <IconX /> Reject
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {data.skipped.length > 0 && (
        <div className="note" style={{ marginTop: 20 }}>
          <div>
            <strong>{data.skipped.length} SKU{data.skipped.length > 1 ? "s were" : " was"} not evaluated:</strong>{" "}
            {data.skipped.map((s) => `${s.skuId} (${s.reason})`).join("; ")}
          </div>
        </div>
      )}

      {rejecting && (
        <RejectDrawer
          item={rejecting}
          onClose={() => setRejecting(null)}
          onSaved={() => {
            setRejecting(null);
            router.refresh();
          }}
        />
      )}
      {bulkOpen && (
        <BulkModal
          runId={run.id}
          items={bulkable}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            router.refresh();
          }}
        />
      )}
      <style>{`@media (max-width: 760px){ .review-cols{grid-template-columns:1fr !important} }`}</style>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "lime" | "clay" }) {
  const color = tone === "amber" ? "var(--amber)" : tone === "lime" ? "var(--lime)" : tone === "clay" ? "var(--clay)" : "var(--text)";
  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="eyebrow">{label}</div>
      <div className="kpi-value" style={{ color, fontSize: 26, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function RejectDrawer({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [flagTypes, setFlagTypes] = useState<string[]>(item.flagTypes);
  const [action, setAction] = useState<string>(item.aiAction);
  const [qty, setQty] = useState<string>(String(item.aiQty));
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const req: ReviewRequest = {
    outcome: "rejected",
    finalFlagTypes: flagTypes,
    finalAction: action,
    finalQty: qty.trim() === "" ? NaN : Number(qty),
    reasonCode: reasonCode || undefined,
    reasonText,
  };
  const check = checkReview({ action: item.aiAction, quantity: item.aiQty, flagTypes: item.flagTypes }, req);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/decisions/${item.decisionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...req, finalQty: Number(qty) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Reject ${item.skuId}`}>
        <div className="card-head">
          <div>
            <div className="card-title">Reject and change</div>
            <div className="faint num" style={{ fontSize: 12 }}>{item.skuId} · {item.skuName}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", display: "grid", gap: 18, alignContent: "start", flex: 1 }}>
          <div className="well">
            <div className="eyebrow">AI decision</div>
            <div className="num" style={{ fontWeight: 600, marginTop: 4 }}>{actionText(item.aiAction, item.aiQty, item.uom)}</div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            You change the flag and the decision for this item only. Rules are never edited here.
          </p>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Flag</legend>
            <div style={{ display: "grid", gap: 2 }}>
              {FLAG_TYPES.map((f) => (
                <label key={f} className="checkrow" style={{ minHeight: 44, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={flagTypes.includes(f)}
                    onChange={(e) => setFlagTypes((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))}
                  />
                  <FlagPill type={f} />
                </label>
              ))}
            </div>
            {flagTypes.length === 0 && <div className="faint" style={{ fontSize: 12 }}>No flag selected means this SKU should not have been flagged.</div>}
          </fieldset>

          <div className="field">
            <label className="label" htmlFor="act">Action</label>
            <select id="act" className="select" value={action} onChange={(e) => { setAction(e.target.value); if (e.target.value !== "REORDER") setQty("0"); }}>
              {FINAL_ACTIONS.map((a) => (
                <option key={a} value={a}>{a === "REORDER" ? "Reorder" : a === "PAUSE_ORDER" ? "Pause next order" : "No action"}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="qty">Quantity ({item.uom.toLowerCase()})</label>
            <input id="qty" className="input num" type="number" min={0} step={1} inputMode="numeric" value={qty} disabled={action !== "REORDER"} onChange={(e) => setQty(e.target.value)} />
          </div>

          <div className="field">
            <label className="label" htmlFor="rc">Reason (required)</label>
            <select id="rc" className="select" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Choose a reason...</option>
              {REASON_CODES.map((c) => (
                <option key={c} value={c}>{REASON_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="rt">Details {reasonCode === "OTHER" ? "(required)" : "(recommended)"}</label>
            <textarea id="rt" className="textarea" value={reasonText} maxLength={500} onChange={(e) => setReasonText(e.target.value)} />
          </div>

          {!check.ok && reasonCode && <div className="note" role="status">{check.error}</div>}
          {error && <div className="note note-clay" role="alert">{error}</div>}
        </div>
        <div style={{ padding: 18, borderTop: "1px solid var(--line-soft)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!check.ok || busy} onClick={save}>
            {busy ? "Saving..." : "Save rejection"}
          </button>
        </div>
      </aside>
    </>
  );
}

function BulkModal({ runId, items, onClose, onDone }: { runId: number; items: Item[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/bulk-accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionIds: items.map((i) => i.decisionId) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Bulk accept failed.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk accept failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Bulk accept">
        <div className="card-head">
          <div>
            <div className="card-title">Accept {items.length} decisions</div>
            <div className="faint" style={{ fontSize: 12 }}>Needs-judgment and fallback rows are never included.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table className="table">
            <thead>
              <tr><th>SKU</th><th>Decision</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.decisionId}>
                  <td><div className="num" style={{ fontWeight: 600 }}>{i.skuId}</div><div className="faint" style={{ fontSize: 12 }}>{i.skuName}</div></td>
                  <td className="num">{actionText(i.aiAction, i.aiQty, i.uom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <div className="note note-clay" style={{ margin: 18 }} role="alert">{error}</div>}
        <div style={{ padding: 18, borderTop: "1px solid var(--line-soft)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? "Accepting..." : `Accept ${items.length}`}</button>
        </div>
      </aside>
    </>
  );
}

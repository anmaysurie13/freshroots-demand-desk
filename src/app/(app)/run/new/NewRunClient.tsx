"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IconArrow, IconCheck } from "@/components/icons";

type FileKey = "sales" | "inventory" | "sku" | "distributor" | "calendar";

const SLOTS: { key: FileKey; label: string; hint: string; master: boolean }[] = [
  { key: "sales", label: "weekly_sales.csv", hint: "SKU_ID, Week, Units_Sold", master: false },
  { key: "inventory", label: "current_inventory.csv", hint: "SKU_ID, Location, Units_On_Hand, As_Of_Date", master: false },
  { key: "sku", label: "sku_master.csv", hint: "Master file", master: true },
  { key: "distributor", label: "distributor_master.csv", hint: "Master file", master: true },
  { key: "calendar", label: "calendar.csv", hint: "Master file", master: true },
];

interface Issue {
  level: "ERROR" | "WARNING";
  code: string;
  file: string;
  row?: number;
  message: string;
}
interface Report {
  blocked: boolean;
  blockedReason: string | null;
  errors: Issue[];
  warnings: Issue[];
  rowCounts: Partial<Record<FileKey, number>>;
  asOfDate: string | null;
  lastCompleteWeek: string | null;
}

const STEPS = ["Upload", "Validate", "Forecast and flag", "AI decisions", "Review", "Buying decision"];

export function NewRunClient({ killed, hasPrevious }: { killed: boolean; hasPrevious: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<Partial<Record<FileKey, File>>>({});
  const [usePrevious, setUsePrevious] = useState(false);
  const [sample, setSample] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<null | "validate" | "run">(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<FileKey, HTMLInputElement | null>>>({});

  const hasInput = sample || Object.keys(files).length > 0;
  const hasErrors = (report?.errors.length ?? 0) > 0;
  const hasWarnings = (report?.warnings.length ?? 0) > 0;
  const canStart = !killed && !!report && !hasErrors && !report.blocked && (!hasWarnings || ack) && busy === null;

  function buildForm(extra: Record<string, string> = {}) {
    const fd = new FormData();
    if (sample) fd.set("sample", "true");
    else for (const s of SLOTS) if (files[s.key]) fd.set(s.key, files[s.key]!);
    if (usePrevious) fd.set("usePrevious", "true");
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  function reset(next: Partial<{ sample: boolean; usePrevious: boolean }> = {}) {
    setReport(null);
    setAck(false);
    setError(null);
    setStep(0);
    if (next.sample !== undefined) setSample(next.sample);
    if (next.usePrevious !== undefined) setUsePrevious(next.usePrevious);
  }

  async function validate() {
    setBusy("validate");
    setError(null);
    setAck(false);
    try {
      const res = await fetch("/api/runs/validate", { method: "POST", body: buildForm() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Validation failed.");
      setReport(data);
      setStep(data.errors.length ? 1 : 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed.");
    }
    setBusy(null);
  }

  async function start() {
    setBusy("run");
    setError(null);
    try {
      setStep(2);
      const res = await fetch("/api/runs", { method: "POST", body: buildForm({ ackWarnings: String(ack) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the run.");
      if (data.flagged === 0) {
        router.push(`/review?run=${data.runId}`);
        return;
      }
      setStep(3);
      const ai = await fetch(`/api/runs/${data.runId}/ai`, { method: "POST" });
      const aiData = await ai.json();
      if (!ai.ok) throw new Error(`${aiData.error ?? "The AI step failed."} The run is saved; open it from Review to retry.`);
      setStep(4);
      router.push(`/review?run=${data.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr) 280px", alignItems: "start" }} className="newrun-grid">
      <div style={{ display: "grid", gap: 20 }}>
        {killed && (
          <div className="note note-clay" role="alert">
            <strong>Start run is disabled.</strong> Automation stopped by a kill switch. Open Safety to see why and who can re-arm it.
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <div className="card-title">1. Upload the SAP export</div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setFiles({}); reset({ sample: !sample, usePrevious: false }); }} disabled={busy !== null}>
              {sample ? "Use my own files" : "Use sample data"}
            </button>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 14 }}>
            {sample && (
              <div className="note note-amber">
                Sample data from the case (inventory as of 2026-10-19). The 7-day inventory age check is skipped for it and shown as a warning. Real uploads are always checked.
              </div>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {SLOTS.map((s) => {
                const f = files[s.key];
                const covered = sample || (s.master && usePrevious);
                return (
                  <div key={s.key} className="well" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", opacity: covered ? 0.55 : 1 }}>
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div className="num" style={{ fontWeight: 500 }}>{s.label}</div>
                      <div className="faint" style={{ fontSize: 12 }}>{s.hint}</div>
                    </div>
                    <div style={{ flex: "1 1 160px", fontSize: 13 }} className="muted">
                      {covered ? (sample ? "From sample data" : "From the previous upload") : f ? `${f.name} · ${(f.size / 1024).toFixed(1)} KB` : "No file chosen"}
                      {report?.rowCounts[s.key] !== undefined && <span className="num"> · {report.rowCounts[s.key]} rows</span>}
                    </div>
                    <input
                      ref={(el) => { inputs.current[s.key] = el; }}
                      id={`f-${s.key}`}
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setFiles((p) => ({ ...p, [s.key]: file ?? undefined }));
                        reset();
                      }}
                    />
                    <button className="btn btn-sm" disabled={covered || busy !== null} onClick={() => inputs.current[s.key]?.click()} aria-label={`Choose ${s.label}`}>
                      {f ? "Replace" : "Choose file"}
                    </button>
                  </div>
                );
              })}
            </div>
            {hasPrevious && !sample && (
              <label className="checkrow">
                <input type="checkbox" checked={usePrevious} onChange={(e) => reset({ usePrevious: e.target.checked })} />
                <span>
                  Use previous master files
                  <span className="faint" style={{ display: "block", fontSize: 12 }}>SKU master, distributor master and calendar are taken from the last upload unless you choose a new one.</span>
                </span>
              </label>
            )}
            <div>
              <button className="btn btn-primary" onClick={validate} disabled={!hasInput || busy !== null}>
                {busy === "validate" ? "Validating..." : "Validate files"}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="note note-clay" role="alert">
            {error}
          </div>
        )}

        {report && (
          <section className="card">
            <div className="card-head">
              <div className="card-title">2. Validation report</div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className={`pill ${hasErrors ? "pill-clay" : "pill-lime"}`}>{report.errors.length} errors</span>
                <span className={`pill ${hasWarnings ? "pill-amber" : "pill-slate"}`}>{report.warnings.length} warnings</span>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              {!hasErrors && report.asOfDate && (
                <div className="note note-lime">
                  <IconCheck /> No errors. Data as of <span className="num">{report.asOfDate}</span>, last complete week <span className="num">{report.lastCompleteWeek}</span>.
                </div>
              )}
              {hasErrors && (
                <div className="note note-clay">Errors block the run. Nothing was saved. Fix the files and validate again.</div>
              )}
              <IssueList title="Errors" issues={report.errors} tone="clay" />
              <IssueList title="Warnings" issues={report.warnings} tone="amber" />
              {hasWarnings && !hasErrors && (
                <label className="checkrow">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>I have read the warnings and want to continue.</span>
                </label>
              )}
              <div>
                <button className="btn btn-primary" disabled={!canStart} onClick={start}>
                  {busy === "run" ? "Running..." : "Start run"} <IconArrow />
                </button>
                {killed && <span className="muted" style={{ marginLeft: 12 }}>Disabled: automation stopped.</span>}
              </div>
            </div>
          </section>
        )}
      </div>

      <aside className="card" style={{ padding: 18, position: "sticky", top: 16 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>Run pipeline</div>
        <ol className="tracker">
          {STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step && (busy !== null || step > 0) ? "active" : "";
            return (
              <li key={s} className={state}>
                <span className="tdot">{state === "done" ? <IconCheck /> : i + 1}</span>
                <div style={{ paddingTop: 2 }}>
                  <div style={{ fontWeight: 600, color: state ? "var(--text)" : "var(--faint)" }}>{s}</div>
                  {state === "active" && busy === "run" && <div className="faint" style={{ fontSize: 12 }}>Working...</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </aside>
      <style>{`@media (max-width: 960px){ .newrun-grid{grid-template-columns:1fr !important} }`}</style>
    </div>
  );
}

function IssueList({ title, issues, tone }: { title: string; issues: Issue[]; tone: "clay" | "amber" }) {
  if (!issues.length) return null;
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Row</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i, n) => (
              <tr key={n}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <span className={`pill pill-${tone}`}>{i.file}</span>
                </td>
                <td className="num">{i.row ?? ""}</td>
                <td>{i.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

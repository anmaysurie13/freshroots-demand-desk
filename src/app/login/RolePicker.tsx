"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLES = [
  { role: "raghav", name: "Raghav", title: "Senior demand planner", does: "Uploads data, starts runs, reviews every decision" },
  { role: "procurement", name: "Procurement", title: "Buying team", does: "Places orders, sends decisions to HubSpot, exports CSV" },
  { role: "priya", name: "Priya", title: "Data analyst", does: "Enters quarterly losses, owns the dashboard" },
  { role: "deepa", name: "Deepa", title: "Head of operations", does: "Reads everything, acknowledges alerts, re-arms kill switches" },
  { role: "ceo", name: "CEO", title: "Chief executive", does: "Dashboard, alerts, re-arms kill switches" },
  { role: "admin", name: "Admin", title: "Administrator", does: "Manages accounts, audit log, break-glass review" },
] as const;

export function RolePicker() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(role: string) {
    setBusy(role);
    setError(null);
    try {
      const res = await fetch("/api/auth/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not start a session.");
      router.replace(j.redirect);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a session.");
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {ROLES.map((r) => (
        <button
          key={r.role}
          type="button"
          data-role={r.role}
          disabled={busy !== null}
          onClick={() => pick(r.role)}
          className="btn"
          style={{ justifyContent: "space-between", textAlign: "left", padding: "12px 16px", minHeight: 64, gap: 16 }}
        >
          <span>
            <span style={{ display: "block", fontWeight: 650 }}>
              {r.name} <span className="faint" style={{ fontWeight: 500, fontSize: 12 }}>· {r.title}</span>
            </span>
            <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 12.5 }}>{r.does}</span>
          </span>
          <span className="faint" aria-hidden="true">{busy === r.role ? "..." : "→"}</span>
        </button>
      ))}
      {error && <div className="note note-clay" role="alert">{error}</div>}
    </div>
  );
}

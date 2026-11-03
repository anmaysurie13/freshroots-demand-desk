import type { ReactNode } from "react";

const FLAG_STYLE: Record<string, { cls: string; label: string }> = {
  STOCKOUT_RISK: { cls: "pill-amber", label: "Stockout risk" },
  HIGH_DEMAND: { cls: "pill-teal", label: "High demand" },
  OVERSTOCK_RISK: { cls: "pill-iris", label: "Overstock risk" },
};

export function FlagPill({ type }: { type: string }) {
  const s = FLAG_STYLE[type] ?? { cls: "pill-slate", label: type };
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export function Pill({ tone, children }: { tone: "teal" | "amber" | "iris" | "lime" | "clay" | "slate" | "judge"; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export const ACTION_TEXT: Record<string, string> = {
  REORDER: "Reorder",
  PAUSE_ORDER: "Pause next order",
  NO_ACTION: "No action",
};

export function actionText(action: string, qty: number, uom = "units"): string {
  if (action === "REORDER") return `Reorder ${qty.toLocaleString("en-IN")} ${uom.toLowerCase()}`;
  return ACTION_TEXT[action] ?? action;
}

/** Cover in weeks against the allowed band. The marker turns amber when cover is outside the band. */
export function CoverBar({ cover, min, max }: { cover: number | null; min: number; max: number }) {
  const scaleMax = Math.max(max * 1.5, (cover ?? max * 1.5) * 1.08, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
  const out = cover === null || cover < min || cover > max;
  return (
    <div className="cover" role="img" aria-label={cover === null ? "No demand, cover is unbounded" : `Cover ${cover.toFixed(2)} weeks, allowed ${min} to ${max}`}>
      <div className="cover-band" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
      <div className={`cover-mark ${out ? "out" : ""}`} style={{ left: cover === null ? "100%" : pct(cover) }} />
    </div>
  );
}

export function Kpi({ label, value, note, tone, children }: { label: string; value: ReactNode; note?: ReactNode; tone?: "teal" | "amber" | "clay" | "lime"; children?: ReactNode }) {
  const color = tone === "amber" ? "var(--amber)" : tone === "clay" ? "var(--clay)" : tone === "lime" ? "var(--lime)" : tone === "teal" ? "var(--teal)" : "var(--text)";
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow">{label}</div>
      <div className="kpi-value" style={{ color, marginTop: 8 }}>
        {value}
      </div>
      {note && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{note}</div>}
      {children}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="h1" style={{ margin: 0 }}>{title}</h1>
        {sub && <p className="muted" style={{ margin: "6px 0 0", maxWidth: 680 }}>{sub}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card" style={{ padding: "44px 24px", textAlign: "center" }}>
      <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
      {children && <div className="muted" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

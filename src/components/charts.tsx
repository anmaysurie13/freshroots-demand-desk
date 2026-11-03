// Dependency-free SVG charts. Colours come from the theme tokens; every mark has a <title> for hover and screen readers.

const W = 640;
const H = 240;
const PAD = { l: 52, r: 16, t: 16, b: 34 };

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      {children}
    </svg>
  );
}

function lakhLabel(n: number) {
  return n === 0 ? "0" : `${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`;
}

/** Cumulative quarter-to-date loss against the two bands. */
export function LossLine({ points, alertAt, killAt }: { points: { label: string; total: number }[]; alertAt: number; killAt: number }) {
  const max = Math.max(killAt * 1.15, ...points.map((p) => p.total), 1);
  const x = (i: number) => PAD.l + (points.length <= 1 ? (W - PAD.l - PAD.r) / 2 : (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const ticks = [0, alertAt, killAt];
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.total)}`).join(" ");
  return (
    <Frame label="Quarter-to-date loss against the alert and kill levels">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === killAt ? "var(--clay)" : t === alertAt ? "var(--amber)" : "var(--line)"} strokeDasharray={t === 0 ? undefined : "5 5"} strokeWidth="1" opacity={t === 0 ? 1 : 0.8} />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)">{lakhLabel(t)}</text>
        </g>
      ))}
      <text x={W - PAD.r} y={y(alertAt) - 5} textAnchor="end" fontSize="10.5" fill="var(--amber)">alert Rs 28L</text>
      <text x={W - PAD.r} y={y(killAt) - 5} textAnchor="end" fontSize="10.5" fill="var(--clay)">kill Rs 34L</text>
      {points.length > 0 && <path d={path} fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.total)} r="4.5" fill="var(--bg)" stroke="var(--teal)" strokeWidth="2">
            <title>{`${p.label}: Rs ${Math.round(p.total).toLocaleString("en-IN")}`}</title>
          </circle>
        </g>
      ))}
    </Frame>
  );
}

/** Cumulative reversal rate by reviewed decision, with the 10% line and the 30-decision minimum. */
export function ReversalChart({ points, thresholdPct, minReviewed }: { points: { n: number; ratePct: number }[]; thresholdPct: number; minReviewed: number }) {
  const maxN = Math.max(minReviewed + 10, points.length, 1);
  const maxY = Math.max(thresholdPct * 2, ...points.map((p) => p.ratePct), 1);
  const x = (n: number) => PAD.l + (n / maxN) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / maxY) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.n)},${y(p.ratePct)}`).join(" ");
  return (
    <Frame label="Cumulative reversal rate against the 10 percent kill line">
      {[0, thresholdPct, maxY].map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === thresholdPct ? "var(--clay)" : "var(--line)"} strokeDasharray={t === 0 ? undefined : "5 5"} />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)">{Math.round(t)}%</text>
        </g>
      ))}
      <line x1={x(minReviewed)} x2={x(minReviewed)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line)" strokeDasharray="2 4" />
      <text x={x(minReviewed) + 5} y={PAD.t + 10} fontSize="10.5" fill="var(--faint)">{minReviewed} reviewed: Kill 1 can fire</text>
      <text x={W - PAD.r} y={y(thresholdPct) - 5} textAnchor="end" fontSize="10.5" fill="var(--clay)">10% kill line</text>
      {points.length > 1 && <path d={path} fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinejoin="round" />}
      {points.length === 1 && <circle cx={x(1)} cy={y(points[0].ratePct)} r="4" fill="var(--teal)" />}
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--faint)">reviewed AI decisions</text>
      {points.length > 0 && <title>{`Latest: ${points[points.length - 1].ratePct.toFixed(1)}% after ${points[points.length - 1].n} decisions`}</title>}
    </Frame>
  );
}

export function BarList({ rows, color = "var(--teal)" }: { rows: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
            <span>{r.label}</span>
            <span className="num">{r.value}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: color, borderRadius: 99 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Flags per run, stacked by type. */
export function FlagStack({ rows }: { rows: { label: string; high: number; stockout: number; overstock: number }[] }) {
  const max = Math.max(...rows.map((r) => r.high + r.stockout + r.overstock), 1);
  const bw = Math.min(46, ((W - PAD.l - PAD.r) / Math.max(rows.length, 1)) * 0.6);
  const slot = (W - PAD.l - PAD.r) / Math.max(rows.length, 1);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  return (
    <Frame label="Flags per run by type">
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      {[max].map((t) => (
        <text key={t} x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)">{t}</text>
      ))}
      {rows.map((r, i) => {
        const cx = PAD.l + slot * i + slot / 2;
        const segs = [
          { v: r.stockout, c: "var(--amber)", n: "Stockout risk" },
          { v: r.high, c: "var(--teal)", n: "High demand" },
          { v: r.overstock, c: "var(--iris)", n: "Overstock risk" },
        ];
        let acc = 0;
        return (
          <g key={r.label}>
            {segs.map((s) => {
              const y0 = y(acc + s.v);
              const h = y(acc) - y0;
              acc += s.v;
              return s.v > 0 ? (
                <rect key={s.n} x={cx - bw / 2} y={y0} width={bw} height={h} fill={s.c} rx="3">
                  <title>{`Run ${r.label}: ${s.n} ${s.v}`}</title>
                </rect>
              ) : null;
            })}
            <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--faint)">{r.label}</text>
          </g>
        );
      })}
    </Frame>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Horizontal gauge for quarter-to-date loss with the two band ticks. */
export function LossGauge({ total, alertAt, killAt }: { total: number; alertAt: number; killAt: number }) {
  const max = killAt * 1.2;
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const color = total > killAt ? "var(--clay)" : total > alertAt ? "var(--amber)" : "var(--lime)";
  return (
    <div style={{ marginTop: 14 }} role="img" aria-label={`Loss Rs ${Math.round(total).toLocaleString("en-IN")}; alert at Rs 28 lakh, kill at Rs 34 lakh`}>
      <div style={{ position: "relative", height: 8, borderRadius: 99, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
        <div style={{ width: pct(total), height: "100%", background: color, borderRadius: 99 }} />
        {[alertAt, killAt].map((t) => (
          <div key={t} style={{ position: "absolute", left: pct(t), top: -4, bottom: -4, width: 2, background: t === killAt ? "var(--clay)" : "var(--amber)" }} />
        ))}
      </div>
      <div style={{ position: "relative", height: 16, fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
        <span style={{ position: "absolute", left: pct(alertAt), transform: "translateX(-50%)" }}>28L</span>
        <span style={{ position: "absolute", left: pct(killAt), transform: "translateX(-50%)" }}>34L</span>
      </div>
    </div>
  );
}

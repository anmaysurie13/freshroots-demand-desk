import Link from "next/link";
import { BarList, FlagStack, Legend, LossGauge, LossLine, ReversalChart } from "@/components/charts";
import { Kpi, PageHead, Pill } from "@/components/ui";
import { rulesConfig } from "@/lib/config";
import { fmtDateTime, hours, lakh, pct, rupees } from "@/lib/format";
import { REASON_LABELS } from "@/lib/review-rules";
import { requirePage } from "@/lib/server/auth";
import { listLoss } from "@/lib/server/loss";
import { getDashboard } from "@/lib/server/queries";
import { LossForm } from "./LossForm";

export const metadata = { title: "Dashboard · Demand Desk" };

function Def({ text }: { text: string }) {
  return (
    <abbr title={text} tabIndex={0} style={{ textDecoration: "none", cursor: "help", marginLeft: 6, color: "var(--faint)", border: "1px solid var(--line)", borderRadius: 99, fontSize: 10, padding: "0 5px" }}>
      i
    </abbr>
  );
}

export default async function DashboardPage() {
  const user = await requirePage();
  const [d, losses] = await Promise.all([getDashboard(), listLoss(30)]);
  const k2 = rulesConfig.kill2;
  const k1 = d.kill.kill1;
  const kill1Killed = d.kill.state.kill1State === "killed";
  const kill2State = d.kill.kill2State;

  const cumulative = d.lossSeries.reduce<{ label: string; total: number }[]>((acc, l) => {
    const prev = acc.length ? acc[acc.length - 1].total : 0;
    acc.push({ label: l.label, total: prev + l.stockout + l.overstock });
    return acc;
  }, []);

  return (
    <>
      <PageHead
        title="Dashboard"
        sub={`Results measured in the world: rupee losses and the planner's reversal rate, not how busy the system was. ${d.quarter.label}.`}
        actions={user.role === "priya" ? <a className="btn" href="/api/metrics/export" download>Export metrics CSV</a> : undefined}
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 20 }}>
        <Kpi
          label={`Quarter-to-date loss${""}`}
          value={lakh(d.quarter.total)}
          tone={d.quarter.state === "killed" ? "clay" : d.quarter.state === "alert" ? "amber" : "lime"}
          note={
            <>
              Stockout {lakh(d.quarter.stockout)} · overstock {lakh(d.quarter.overstock)}
              <Def text="Sum of stockout lost sales plus overstock write-offs entered for the current calendar quarter. Baseline: Rs 28 to 34 lakh per quarter." />
            </>
          }
        >
          <LossGauge total={d.quarter.total} alertAt={k2.alertAbove} killAt={k2.killAbove} />
        </Kpi>

        <Kpi
          label="Kill 1: reversal monitor"
          value={k1.collecting ? `${k1.reviewed} of ${rulesConfig.kill1.minReviewed}` : pct(k1.ratePct)}
          tone={kill1Killed ? "clay" : k1.collecting ? undefined : "lime"}
          note={
            kill1Killed ? (
              <Pill tone="clay">Killed</Pill>
            ) : k1.collecting ? (
              <>Collecting data: {k1.reviewed} of {rulesConfig.kill1.minReviewed} reviewed<Def text="Reversals divided by reviewed AI decisions (fallbacks excluded), counted since go-live or the last re-arm. Fires at 10% or more once 30 are reviewed." /></>
            ) : (
              <>{k1.reversed} reversed of {k1.reviewed} · fires at {rulesConfig.kill1.thresholdPct}%<Def text="Reversals divided by reviewed AI decisions (fallbacks excluded), counted since go-live or the last re-arm. Fires at 10% or more once 30 are reviewed." /></>
            )
          }
        />

        <Kpi
          label="Kill 2: outcome gate"
          value={kill2State === "killed" ? "Killed" : kill2State === "alert" ? "Alert" : "Green"}
          tone={kill2State === "killed" ? "clay" : kill2State === "alert" ? "amber" : "lime"}
          note={
            <>
              Alert above {lakh(k2.alertAbove)}, kill above {lakh(k2.killAbove)}
              <Def text="Strictly above Rs 28,00,000 alerts. Strictly above Rs 34,00,000 stops the automation. A killed state survives a quarter change until re-armed." />
            </>
          }
        />

        <Kpi
          label="Data age at buying"
          value={d.workflow.dataAgeDays === null ? "n/a" : `${d.workflow.dataAgeDays.toFixed(1)} d`}
          note={
            <>
              Before this system: 21 to 28 days
              <Def text="Date an order was marked placed minus the as-of date of the run's data, averaged over placed orders." />
            </>
          }
        />
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", marginBottom: 20 }}>
        <section className="card">
          <div className="card-head"><div className="card-title">Loss in {d.quarter.label}</div></div>
          <div className="card-body">
            {cumulative.length ? <LossLine points={cumulative} alertAt={k2.alertAbove} killAt={k2.killAbove} /> : <p className="muted" style={{ margin: 0 }}>No loss entries yet. Priya enters weekly or monthly figures.</p>}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div className="card-title">Reversal rate</div></div>
          <div className="card-body">
            {d.reversalSeries.length ? (
              <ReversalChart points={d.reversalSeries} thresholdPct={rulesConfig.kill1.thresholdPct} minReviewed={rulesConfig.kill1.minReviewed} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>No reviewed AI decisions yet.</p>
            )}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", marginBottom: 20 }}>
        <section className="card">
          <div className="card-head"><div className="card-title">Rejection reasons</div></div>
          <div className="card-body">
            {d.reasons.length ? (
              <BarList color="var(--clay)" rows={d.reasons.map((r) => ({ label: REASON_LABELS[r.code as keyof typeof REASON_LABELS] ?? r.code, value: r.n })).sort((a, b) => b.value - a.value)} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>No rejections yet.</p>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div className="card-title">Flags per run</div></div>
          <div className="card-body">
            {d.flagTypeCounts.length ? (
              <>
                <FlagStack rows={d.flagTypeCounts} />
                <Legend items={[{ color: "var(--amber)", label: "Stockout risk" }, { color: "var(--teal)", label: "High demand" }, { color: "var(--iris)", label: "Overstock risk" }]} />
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>No runs yet. Upload this week&apos;s SAP files.</p>
            )}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginBottom: 20 }}>
        <Kpi
          label="AI flags issued"
          value={String(d.quality.aiIssued)}
          note={
            <>
              {d.quality.aiReviewed} reviewed · {d.quality.aiReversed} reversed
              <Def text="All AI flag decisions since go-live (rule-engine fallbacks are not counted), how many Raghav has reviewed, and how many he reversed by changing the action or quantity." />
            </>
          }
        />
        <Kpi label="AI fallback rate" value={pct(d.quality.fallbackRatePct)} note={<>Warn above {rulesConfig.ai.fallbackWarningPct}% in a run<Def text="Fallback decisions divided by all decisions." /></>} />
        <Kpi label="Needs-judgment share" value={pct(d.quality.needsJudgmentPct)} note={<>Proxy for the cases rules cannot cover<Def text="Decisions marked needs-judgment divided by all decisions." /></>} />
        <Kpi label="Review turnaround" value={hours(d.workflow.reviewTurnaroundHours)} note="Run created to last review" />
        <Kpi label="Order lag" value={hours(d.workflow.orderLagHours)} note="Review saved to order placed" />
        <Kpi label="Runs this month" value={String(d.workflow.runsThisMonth)} note="Before: 1 a month" />
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><div className="card-title">Run history</div></div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr><th>Run</th><th>Created</th><th>Data as of</th><th>Flags</th><th>Accepted</th><th>Rejected</th><th>Fallback</th><th>Turnaround</th><th>Status</th></tr>
            </thead>
            <tbody>
              {d.runHistory.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>No run yet.</td></tr>}
              {d.runHistory.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/review?run=${r.id}`} className="num">#{r.id}</Link></td>
                  <td>{fmtDateTime(r.createdAt)}</td>
                  <td className="num">{r.asOfDate}</td>
                  <td className="num">{r.flags}</td>
                  <td className="num">{r.accepted}</td>
                  <td className="num">{r.rejected}</td>
                  <td className="num">{r.fallback}</td>
                  <td className="num">{hours(r.turnaroundHours)}</td>
                  <td><Pill tone={r.status === "completed" ? "lime" : r.status === "blocked" ? "clay" : "amber"}>{r.status.replace("_", " ")}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: user.role === "priya" ? "minmax(0,1fr) minmax(0,1.3fr)" : "minmax(0,1fr)" }} className="loss-grid">
        {user.role === "priya" && <LossForm today={d.today} quarterLabel={d.quarter.label} />}
        <section className="card">
          <div className="card-head"><div className="card-title">Loss entries</div></div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr><th>Period</th><th>Stockout</th><th>Overstock</th><th>Total</th><th>Note</th></tr>
              </thead>
              <tbody>
                {losses.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No entries yet.</td></tr>}
                {losses.map((l) => (
                  <tr key={l.id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{l.periodStart} to {l.periodEnd}</td>
                    <td className="num">{rupees(Number(l.stockoutLoss))}</td>
                    <td className="num">{rupees(Number(l.overstockWriteoff))}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{rupees(Number(l.stockoutLoss) + Number(l.overstockWriteoff))}</td>
                    <td className="muted">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <style>{`@media (max-width: 960px){ .loss-grid{grid-template-columns:1fr !important} }`}</style>
    </>
  );
}

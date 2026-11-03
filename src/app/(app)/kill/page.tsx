import { getDb } from "@/db";
import { PageHead, Pill } from "@/components/ui";
import { rulesConfig } from "@/lib/config";
import { fmtDateTime, lakh, pct } from "@/lib/format";
import { requirePage } from "@/lib/server/auth";
import { getKillRow, kill1Counts, latestKillEvents, quarterLoss } from "@/lib/server/kill";
import { getOutbox } from "@/lib/server/queries";
import { KillClient } from "./KillClient";

export const metadata = { title: "Safety · Demand Desk" };

const EVENT_TONE = { alert: "amber", killed: "clay", rearmed: "lime" } as const;

export default async function KillPage() {
  const user = await requirePage();
  const [k, events, outbox, ql] = await Promise.all([getKillRow(), latestKillEvents(30), getOutbox(12), quarterLoss(getDb())]);
  const k1 = await kill1Counts(getDb(), k.kill1EpochStart);
  const canAct = user.role === "deepa" || user.role === "ceo";
  const pendingAlert = events.find((e) => e.switch === 2 && e.event === "alert" && !e.acknowledgedAt);

  return (
    <>
      <PageHead
        title="Safety"
        sub="Two monitors sit outside the workflow and stop the automation on their own. Only Deepa or the CEO can re-arm them, with a written reason."
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: 20 }}>
        <section className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-title">Kill 1: reversal monitor</div>
            <Pill tone={k.kill1State === "killed" ? "clay" : "lime"}>{k.kill1State === "killed" ? "Killed" : "Armed"}</Pill>
          </div>
          <p className="muted" style={{ margin: "10px 0 0" }}>
            Fires when Raghav reverses {rulesConfig.kill1.thresholdPct}% or more of reviewed AI decisions, once {rulesConfig.kill1.minReviewed} are reviewed. Fallback decisions are not counted.
          </p>
          <div className="num" style={{ marginTop: 12 }}>
            {k1.collecting ? `Collecting data: ${k1.reviewed} of ${rulesConfig.kill1.minReviewed}` : `${k1.reversed} of ${k1.reviewed} reversed (${pct(k1.ratePct)})`}
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Counting since {fmtDateTime(k.kill1EpochStart)}</div>
        </section>
        <section className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-title">Kill 2: outcome gate</div>
            <Pill tone={k.kill2State === "killed" ? "clay" : k.kill2State === "alert" ? "amber" : "lime"}>{k.kill2State === "killed" ? "Killed" : k.kill2State === "alert" ? "Alert" : "Green"}</Pill>
          </div>
          <p className="muted" style={{ margin: "10px 0 0" }}>
            Alert above {lakh(rulesConfig.kill2.alertAbove)}, kill above {lakh(rulesConfig.kill2.killAbove)} of quarterly loss. A killed state survives a quarter change until re-armed.
          </p>
          <div className="num" style={{ marginTop: 12 }}>{ql.quarter.label}: {lakh(ql.total)}</div>
        </section>
      </div>

      <KillClient
        canAct={canAct}
        kill1Killed={k.kill1State === "killed"}
        kill2Killed={k.kill2State === "killed"}
        kill2Total={ql.total}
        killAbove={rulesConfig.kill2.killAbove}
        pendingAlert={pendingAlert ? { id: pendingAlert.id, at: pendingAlert.createdAt.toISOString() } : null}
      />

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-head"><div className="card-title">Event history</div></div>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>When</th><th>Switch</th><th>Event</th><th>Metric</th><th>Details</th></tr></thead>
            <tbody>
              {events.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No events. Both switches have stayed quiet.</td></tr>}
              {events.map((e) => {
                const d = e.details as Record<string, unknown>;
                return (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.createdAt)}</td>
                    <td className="num">Kill {e.switch}</td>
                    <td><Pill tone={EVENT_TONE[e.event as keyof typeof EVENT_TONE] ?? "slate"}>{e.event}</Pill></td>
                    <td className="num">{e.metricValue === null ? "" : Number(e.metricValue).toLocaleString("en-IN")} {e.threshold !== null && <span className="faint">/ {Number(e.threshold).toLocaleString("en-IN")}</span>}</td>
                    <td className="muted" style={{ maxWidth: 420 }}>
                      {e.event === "rearmed" ? `${String(d.by)}: ${String(d.reason)}` : e.event === "alert" && e.acknowledgedAt ? `Acknowledged ${fmtDateTime(e.acknowledgedAt)}` : e.event === "alert" ? "Waiting for acknowledgement" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div className="card-title">Email outbox</div>
          <span className="faint" style={{ fontSize: 12 }}>Console provider: messages are logged here, not sent</span>
        </div>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>When</th><th>To</th><th>Subject</th></tr></thead>
            <tbody>
              {outbox.length === 0 && <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 24 }}>Nothing queued.</td></tr>}
              {outbox.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(m.createdAt)}</td>
                  <td className="num">{m.toEmail}</td>
                  <td>{m.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

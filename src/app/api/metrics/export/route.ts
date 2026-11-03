import { csvCell } from "@/lib/csv";
import { audit } from "@/lib/server/audit";
import { jsonError, requireApi } from "@/lib/server/auth";
import { getDb } from "@/db";
import { getDashboard } from "@/lib/server/queries";
import { listLoss } from "@/lib/server/loss";

/** Priya's metrics export: loss entries plus the headline quality and workflow numbers. */
export async function GET() {
  try {
    const user = await requireApi(["priya"]);
    const [d, loss] = await Promise.all([getDashboard(), listLoss(500)]);
    const rows: unknown[][] = [
      ["Quarter", d.quarter.label],
      ["Quarter-to-date loss (Rs)", d.quarter.total],
      ["Stockout loss (Rs)", d.quarter.stockout],
      ["Overstock write-off (Rs)", d.quarter.overstock],
      ["Kill 2 state", d.kill.kill2State],
      ["Kill 1 state", d.kill.state.kill1State],
      ["Reviewed AI decisions since epoch", d.kill.kill1.reviewed],
      ["Reversals since epoch", d.kill.kill1.reversed],
      ["Reversal rate (%)", d.kill.kill1.ratePct === null ? "" : d.kill.kill1.ratePct.toFixed(2)],
      ["AI fallback rate (%)", d.quality.fallbackRatePct === null ? "" : d.quality.fallbackRatePct.toFixed(2)],
      ["Needs-judgment share (%)", d.quality.needsJudgmentPct === null ? "" : d.quality.needsJudgmentPct.toFixed(2)],
      ["Data age at buying decision (days, average)", d.workflow.dataAgeDays === null ? "" : d.workflow.dataAgeDays.toFixed(1)],
      ["Order lag (hours, average)", d.workflow.orderLagHours === null ? "" : d.workflow.orderLagHours.toFixed(1)],
      ["Runs completed this month", d.workflow.runsThisMonth],
      [],
      ["Period start", "Period end", "Stockout loss (Rs)", "Overstock write-off (Rs)", "Note"],
      ...loss.map((l) => [l.periodStart, l.periodEnd, l.stockoutLoss, l.overstockWriteoff, l.note ?? ""]),
    ];
    await audit(getDb(), { actor: user, action: "metrics.exported", entity: "dashboard" });
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="metrics.csv"', "Cache-Control": "no-store" },
    });
  } catch (e) {
    return jsonError(e);
  }
}

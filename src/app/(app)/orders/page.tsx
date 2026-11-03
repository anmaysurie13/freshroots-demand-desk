import { Empty, PageHead } from "@/components/ui";
import { requirePage } from "@/lib/server/auth";
import { automationStopped } from "@/lib/server/kill";
import { listBuyingDecisions } from "@/lib/server/orders";
import { OrdersClient } from "./OrdersClient";

export const metadata = { title: "Orders · Demand Desk" };

export default async function OrdersPage() {
  const user = await requirePage();
  const rows = await listBuyingDecisions();
  const stop = await automationStopped();
  const payload = JSON.parse(JSON.stringify(rows));

  return (
    <>
      <PageHead
        title="Orders"
        sub="Final buying decisions from reviewed AI decisions. Procurement places the orders; the system never orders on its own."
        actions={
          (user.role === "procurement" || user.role === "admin") && rows.length > 0 ? (
            <a className="btn btn-primary" href="/api/orders/export" download>
              Export CSV
            </a>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <Empty title="No buying decisions yet.">Decisions appear here once Raghav has reviewed a run.</Empty>
      ) : (
        <OrdersClient rows={payload} canPlace={user.role === "procurement"} killed={stop.stopped} />
      )}
      <section className="card" style={{ marginTop: 24, padding: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div>
          <div className="card-title">Zoho Inventory sync</div>
          <div className="muted" style={{ fontSize: 13 }}>Not connected. Orders are exported as CSV. A later integration will create draft purchase orders only.</div>
        </div>
        <span className="pill pill-slate">Not connected</span>
      </section>
    </>
  );
}

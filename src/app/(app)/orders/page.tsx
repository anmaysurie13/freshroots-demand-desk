import { Empty, PageHead } from "@/components/ui";
import { requirePage } from "@/lib/server/auth";
import { automationStopped } from "@/lib/server/kill";
import { hubspotConfigured } from "@/lib/orders/hubspot";
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
        sub="Final buying decisions from reviewed AI decisions. Procurement places the orders and sends them to HubSpot; the system never does either on its own."
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
        <OrdersClient rows={payload} canPlace={user.role === "procurement"} killed={stop.stopped} hubspot={hubspotConfigured()} />
      )}
    </>
  );
}

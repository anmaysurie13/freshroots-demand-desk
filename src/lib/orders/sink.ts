import { toCsv } from "../csv";

export interface BuyingDecision {
  id: number;
  runId: number;
  skuId: string;
  skuName: string;
  action: string;
  quantity: number;
  source: string;
  reasonCode: string | null;
  status: string;
  sink?: string;
  sinkRef?: string | null;
  asOfDate: string;
  createdAt: Date;
}

/**
 * Where final decisions go. CSV is the export for procurement; HubSpot (see hubspot.ts) creates one deal per decision
 * and only when procurement asks for it.
 */
export interface OrderSink {
  name: "csv" | "hubspot";
  createDraftOrders(decisions: BuyingDecision[]): Promise<{ ref: string; results: Array<{ skuId: string; ok: boolean; error?: string }> }>;
}

const ACTION_LABEL: Record<string, string> = {
  REORDER: "Reorder",
  PAUSE_ORDER: "Hold the next order",
};

export function buyingCsv(decisions: BuyingDecision[]): string {
  return toCsv(
    ["Run", "SKU_ID", "SKU_Name", "Action", "Quantity", "Source", "Change_Reason", "Status", "HubSpot_Deal_Id", "Data_As_Of", "Decided_At"],
    decisions.map((d) => [
      d.runId,
      d.skuId,
      d.skuName,
      ACTION_LABEL[d.action] ?? d.action,
      d.quantity,
      d.source === "ai_accepted" ? "AI accepted" : "Planner changed",
      d.reasonCode ?? "",
      d.status,
      d.sink === "hubspot" ? (d.sinkRef ?? "") : "",
      d.asOfDate,
      d.createdAt.toISOString(),
    ]),
  );
}

export const CsvSink: OrderSink = {
  name: "csv",
  async createDraftOrders(decisions) {
    return { ref: `csv-${Date.now()}`, results: decisions.map((d) => ({ skuId: d.skuId, ok: true })) };
  },
};

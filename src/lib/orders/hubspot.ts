import type { BuyingDecision, OrderSink } from "./sink";

/**
 * HubSpot has no purchase orders or inventory, so a buying decision becomes a DEAL that procurement works from.
 * Only fields documented for deal creation are sent: dealname, and pipeline / dealstage when configured.
 * (HubSpot's docs say a pipeline defaults when omitted, and do not say what a missing stage does,
 *  so set HUBSPOT_DEAL_STAGE if HubSpot rejects a deal without one.)
 */

export class HubSpotError extends Error {
  constructor(
    message: string,
    public status: number | null = null,
  ) {
    super(message);
  }
}

const OFFICIAL_BASE = "https://api.hubapi.com";

export function hubspotConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.HUBSPOT_ACCESS_TOKEN;
}

/** The API host. Only HubSpot's own host is allowed, plus localhost outside production for tests. */
export function hubspotBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HUBSPOT_API_BASE;
  if (!override) return OFFICIAL_BASE;
  const ok = override === OFFICIAL_BASE || (env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override));
  if (!ok) throw new HubSpotError("HUBSPOT_API_BASE is not an allowed address.");
  return override;
}

const VERB: Record<string, string> = { REORDER: "Reorder", PAUSE_ORDER: "Hold next order" };

export interface DealPayload {
  properties: Record<string, string>;
  associations: never[];
}

/** HubSpot's schema types every property value as a string. */
export function dealPayload(d: Pick<BuyingDecision, "action" | "quantity" | "skuId" | "skuName" | "runId">, env: NodeJS.ProcessEnv = process.env): DealPayload {
  const what = d.action === "REORDER" ? `Reorder ${d.quantity}` : (VERB[d.action] ?? d.action);
  const properties: Record<string, string> = {
    dealname: `${what} · ${d.skuId} ${d.skuName} · run #${d.runId}`.slice(0, 250),
  };
  if (env.HUBSPOT_PIPELINE) properties.pipeline = env.HUBSPOT_PIPELINE;
  if (env.HUBSPOT_DEAL_STAGE) properties.dealstage = env.HUBSPOT_DEAL_STAGE;
  return { properties, associations: [] };
}

type FetchLike = typeof fetch;

/** Creates one deal. The token is never put into an error message. */
export async function createDeal(payload: DealPayload, env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch): Promise<{ id: string }> {
  const token = env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new HubSpotError("HubSpot is not connected.");
  let res: Response;
  try {
    res = await fetchImpl(`${hubspotBase(env)}/crm/v3/objects/deals`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    if (e instanceof HubSpotError) throw e;
    throw new HubSpotError("Could not reach HubSpot.");
  }
  const text = await res.text();
  let body: { id?: string; message?: string; category?: string; context?: Record<string, unknown> } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (res.status === 201 || (res.ok && body.id)) {
    if (!body.id) throw new HubSpotError("HubSpot accepted the deal but returned no id.", res.status);
    return { id: String(body.id) };
  }
  const detail = (body.message ?? text).slice(0, 240).split(token).join("[token]");
  const missing = body.context && "missingScopes" in body.context ? ` Missing scopes: ${JSON.stringify(body.context.missingScopes)}.` : "";
  throw new HubSpotError(`HubSpot said ${res.status}: ${detail}${missing}`, res.status);
}

export const HubSpotSink: OrderSink = {
  name: "hubspot",
  async createDraftOrders(decisions) {
    const results: Array<{ skuId: string; ok: boolean; error?: string }> = [];
    for (const d of decisions) {
      try {
        await createDeal(dealPayload(d));
        results.push({ skuId: d.skuId, ok: true });
      } catch (e) {
        results.push({ skuId: d.skuId, ok: false, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return { ref: `hubspot-${Date.now()}`, results };
  },
};

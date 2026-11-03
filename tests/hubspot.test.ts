import { describe, expect, it } from "vitest";
import { HubSpotError, createDeal, dealPayload, hubspotBase, hubspotConfigured } from "../src/lib/orders/hubspot";
import { buyingCsv } from "../src/lib/orders/sink";
import { openAccessEnabled } from "../src/lib/server/auth";

const decision = { action: "REORDER", quantity: 750, skuId: "SKU001", skuName: "Freshroots Mango Drink 200ml", runId: 12 };
const env = (o: Record<string, string>) => ({ ...o }) as unknown as NodeJS.ProcessEnv;
const reply = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("HubSpot deal payload", () => {
  it("sends only documented fields, all values as strings", () => {
    const p = dealPayload(decision, env({}));
    expect(Object.keys(p.properties)).toEqual(["dealname"]);
    expect(p.associations).toEqual([]);
    expect(p.properties.dealname).toBe("Reorder 750 · SKU001 Freshroots Mango Drink 200ml · run #12");
    expect(Object.values(p.properties).every((v) => typeof v === "string")).toBe(true);
  });

  it("adds pipeline and stage only when configured", () => {
    const p = dealPayload(decision, env({ HUBSPOT_PIPELINE: "default", HUBSPOT_DEAL_STAGE: "contractsent" }));
    expect(p.properties).toMatchObject({ pipeline: "default", dealstage: "contractsent" });
  });

  it("words a pause as a hold, not a cancellation", () => {
    const p = dealPayload({ ...decision, action: "PAUSE_ORDER", quantity: 0 }, env({}));
    expect(p.properties.dealname.startsWith("Hold next order")).toBe(true);
  });
});

describe("HubSpot create deal", () => {
  const e = env({ HUBSPOT_ACCESS_TOKEN: "pat-secret-token" });

  it("returns the deal id from a 201", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(JSON.stringify({ id: "512", properties: {}, archived: false }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await createDeal(dealPayload(decision, e), e, f);
    expect(r).toEqual({ id: "512" });
    expect(seen!.url).toBe("https://api.hubapi.com/crm/v3/objects/deals");
    expect(seen!.headers.Authorization).toBe("Bearer pat-secret-token");
    expect(JSON.parse(seen!.body).properties.dealname).toContain("SKU001");
  });

  it("fails clearly when not connected", async () => {
    await expect(createDeal(dealPayload(decision, env({})), env({}), reply(201, { id: "1" }))).rejects.toThrow(/not connected/);
    expect(hubspotConfigured(env({}))).toBe(false);
    expect(hubspotConfigured(e)).toBe(true);
  });

  it("surfaces HubSpot's error message and missing scopes", async () => {
    const f = reply(403, { message: "This app hasn't been granted all required scopes", category: "MISSING_SCOPES", context: { missingScopes: ["crm.objects.deals.write"] } });
    await expect(createDeal(dealPayload(decision, e), e, f)).rejects.toThrow(/403[\s\S]*required scopes[\s\S]*crm\.objects\.deals\.write/);
  });

  it("surfaces a validation error", async () => {
    const f = reply(400, { message: "Property values were not valid", category: "VALIDATION_ERROR" });
    await expect(createDeal(dealPayload(decision, e), e, f)).rejects.toBeInstanceOf(HubSpotError);
  });

  it("never leaks the token, even if HubSpot echoes it", async () => {
    const f = reply(401, `invalid token pat-secret-token`);
    try {
      await createDeal(dealPayload(decision, e), e, f);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("pat-secret-token");
      expect((err as Error).message).toContain("401");
    }
  });

  it("reports a network failure without details", async () => {
    const f = (async () => {
      throw new Error("socket hang up pat-secret-token");
    }) as unknown as typeof fetch;
    await expect(createDeal(dealPayload(decision, e), e, f)).rejects.toThrow("Could not reach HubSpot.");
  });

  it("treats a success without an id as a failure", async () => {
    await expect(createDeal(dealPayload(decision, e), e, reply(201, {}))).rejects.toThrow(/no id/);
  });
});

describe("HubSpot base address", () => {
  it("defaults to HubSpot's host", () => {
    expect(hubspotBase(env({}))).toBe("https://api.hubapi.com");
  });
  it("allows localhost for tests outside production only", () => {
    expect(hubspotBase(env({ HUBSPOT_API_BASE: "http://localhost:4010", NODE_ENV: "test" }))).toBe("http://localhost:4010");
    expect(() => hubspotBase(env({ HUBSPOT_API_BASE: "http://localhost:4010", NODE_ENV: "production" }))).toThrow();
  });
  it("refuses any other host", () => {
    expect(() => hubspotBase(env({ HUBSPOT_API_BASE: "https://evil.example.com", NODE_ENV: "test" }))).toThrow();
  });
});

describe("CSV export includes the HubSpot deal id", () => {
  it("shows the deal id only for hubspot rows", () => {
    const base = { id: 1, runId: 1, skuId: "S", skuName: "n", action: "REORDER", quantity: 5, source: "ai_accepted", reasonCode: null, status: "pending", asOfDate: "2026-10-19", createdAt: new Date("2026-11-03T00:00:00Z") };
    const csv = buyingCsv([{ ...base, sink: "hubspot", sinkRef: "777" }, { ...base, id: 2, sink: "csv", sinkRef: null }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("HubSpot_Deal_Id");
    expect(lines[1]).toContain(",777,");
    expect(lines[2]).not.toContain("777");
  });
});

describe("open access switch", () => {
  it("is off unless OPEN_ACCESS_DEMO is exactly true", () => {
    expect(openAccessEnabled(env({}))).toBe(false);
    expect(openAccessEnabled(env({ OPEN_ACCESS_DEMO: "1" }))).toBe(false);
    expect(openAccessEnabled(env({ OPEN_ACCESS_DEMO: "TRUE" }))).toBe(false);
    expect(openAccessEnabled(env({ OPEN_ACCESS_DEMO: "true" }))).toBe(true);
  });
});

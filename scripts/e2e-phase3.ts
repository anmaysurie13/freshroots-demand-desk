/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 3 end-to-end: HubSpot deals per buying decision, against a LOCAL MOCK of HubSpot's API.
// The app server must be started with: HUBSPOT_ACCESS_TOKEN=test-token HUBSPOT_API_BASE=http://localhost:4010
// and NODE_ENV not "production" (the localhost override is refused in production), e.g. `npm run dev -- -p 3100`.
// Run against a throwaway database branch: E2E_BASE=http://localhost:3100 npx tsx scripts/e2e-phase3.ts
import dotenv from "dotenv";
import http from "node:http";
import { BASE, Session, check, sampleForm, section, summary } from "./e2e-lib";

dotenv.config({ path: ".env.local", quiet: true });

interface Seen {
  auth: string;
  body: any;
}

async function main() {
  console.log(`Target: ${BASE}`);
  const seen: Seen[] = [];
  let counter = 9000;
  let failSku003 = true;
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.method === "POST" && req.url === "/crm/v3/objects/deals") {
        seen.push({ auth: String(req.headers.authorization), body });
        if (req.headers.authorization !== "Bearer test-token") {
          res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "bad token", category: "INVALID_AUTHENTICATION" }));
        } else if (failSku003 && String(body.properties?.dealname).includes("SKU003")) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Property values were not valid", category: "VALIDATION_ERROR" }));
        } else {
          res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ id: String(++counter), properties: body.properties, archived: false }));
        }
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => mock.listen(4010, r));

  const { getDb, schema } = await import("../src/db");
  const { eq, and, inArray } = await import("drizzle-orm");
  const db = getDb();

  const raghav = await new Session("raghav").login();
  const procurement = await new Session("procurement").login();
  const priya = await new Session("priya").login();
  const deepa = await new Session("deepa").login();

  await db.update(schema.killState).set({ kill1State: "armed", kill2State: "green", kill1EpochStart: new Date() }).where(eq(schema.killState.id, 1));

  async function newBatch() {
    let r = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
    if (r.status !== 200) throw new Error(`run failed ${r.status} ${JSON.stringify(r.json)}`);
    const runId = r.json.runId as number;
    r = await raghav.call("POST", `/api/runs/${runId}/ai`);
    if (r.status !== 200) throw new Error(`ai failed ${r.status}`);
    const decs = await db.select().from(schema.aiDecisions).where(eq(schema.aiDecisions.runId, runId));
    for (const d of decs) await raghav.call("POST", `/api/decisions/${d.id}/review`, { outcome: "accepted" });
    return db.select().from(schema.buyingDecisions).where(eq(schema.buyingDecisions.runId, runId));
  }

  section("Access");
  let r = await raghav.call("POST", "/api/orders/hubspot", {});
  check("raghav cannot send to HubSpot (403)", r.status === 403, r.status);
  for (const s of [priya, deepa]) check(`${s.role} cannot send to HubSpot (403)`, (await s.call("POST", "/api/orders/hubspot", {})).status === 403);
  check("signed out is 401", (await new Session("raghav").call("POST", "/api/orders/hubspot", {})).status === 401);

  section("Sending: one deal per decision, one failure");
  const batch1 = await newBatch();
  const ids1 = batch1.map((b) => b.id);
  check("a run's reviewed decisions are pending buying decisions", batch1.length === 7 && batch1.every((b) => b.status === "pending"), batch1.length);

  // One decision is already placed by procurement: it must not be sent.
  const placed = batch1.find((b) => b.skuId === "SKU001")!;
  await procurement.call("POST", `/api/orders/${placed.id}/placed`, { orderRef: "PO-1" });

  r = await procurement.call("POST", "/api/orders/hubspot", { ids: ids1 });
  check("6 sent... of which SKU003 fails: 5 sent, 1 failed", r.status === 200 && r.json.sent === 5 && r.json.failed === 1, r.json);
  const failed = r.json.results.find((x: any) => !x.ok);
  check("the failure names HubSpot's reason", failed?.skuId === "SKU003" && /400.*not valid/.test(failed.error), failed);
  const after1 = await db.select().from(schema.buyingDecisions).where(inArray(schema.buyingDecisions.id, ids1));
  const bySku = Object.fromEntries(after1.map((b) => [b.skuId, b]));
  check("sent rows keep the deal id and sink", after1.filter((b) => b.sink === "hubspot" && b.sinkRef && /^\d+$/.test(b.sinkRef)).length === 5);
  check("the failed row is released (no deal id, can retry)", bySku.SKU003.sinkRef === null && bySku.SKU003.sink === "csv");
  check("the placed row was not sent", bySku.SKU001.sinkRef === null && bySku.SKU001.status === "placed");
  check("HubSpot received 6 calls, all with the bearer token", seen.length === 6 && seen.every((s) => s.auth === "Bearer test-token"), seen.length);
  check("only documented properties were sent (dealname)", seen.every((s) => Object.keys(s.body.properties).join() === "dealname" && Array.isArray(s.body.associations)));
  check("deal names carry the decision", seen.some((s) => s.body.properties.dealname.startsWith("Reorder 750 · SKU001")) || seen.some((s) => /Reorder \d+ · SKU/.test(s.body.properties.dealname)));

  section("Retry sends only what is missing, never duplicates");
  const before = seen.length;
  failSku003 = false;
  r = await procurement.call("POST", "/api/orders/hubspot", { ids: ids1 });
  check("retry sends exactly the one that failed", r.json.sent === 1 && r.json.failed === 0 && seen.length === before + 1, { sent: r.json.sent, calls: seen.length - before });
  r = await procurement.call("POST", "/api/orders/hubspot", { ids: ids1 });
  check("a third call sends nothing", r.json.sent === 0 && seen.length === before + 1, r.json);

  section("Two clicks at the same time create one deal each");
  const batch2 = await newBatch();
  const ids2 = batch2.map((b) => b.id);
  const callsBefore = seen.length;
  const [a, b] = await Promise.all([procurement.call("POST", "/api/orders/hubspot", { ids: ids2 }), procurement.call("POST", "/api/orders/hubspot", { ids: ids2 })]);
  check("together they sent all 7, no more", a.json.sent + b.json.sent === 7 && seen.length === callsBefore + 7, { a: a.json.sent, b: b.json.sent, calls: seen.length - callsBefore });
  const names = seen.slice(callsBefore).map((s) => s.body.properties.dealname);
  check("no decision produced two deals", new Set(names).size === names.length, names);

  section("Held items are not sent");
  const batch3 = await newBatch();
  await db.update(schema.buyingDecisions).set({ status: "held" }).where(eq(schema.buyingDecisions.id, batch3[0].id));
  const callsBefore3 = seen.length;
  r = await procurement.call("POST", "/api/orders/hubspot", { ids: batch3.map((x) => x.id) });
  check("a held decision is skipped", r.json.sent === batch3.length - 1 && seen.length === callsBefore3 + batch3.length - 1, r.json);
  await db.update(schema.buyingDecisions).set({ status: "pending" }).where(eq(schema.buyingDecisions.id, batch3[0].id));

  section("Export and audit");
  r = await procurement.call("GET", "/api/orders/export");
  check("CSV has a HubSpot_Deal_Id column with ids", r.status === 200 && r.text.includes("HubSpot_Deal_Id") && /,\d{4},/.test(r.text), r.text.slice(0, 120));
  const orders = await procurement.call("GET", "/orders");
  check("Orders page shows deal references and the Connected state", orders.text.includes("HubSpot deal") && orders.text.includes("Connected"));
  const audits = await db.select({ a: schema.auditLog.action }).from(schema.auditLog);
  check("audit has order.sent_to_hubspot and order.hubspot_failed", audits.some((x) => x.a === "order.sent_to_hubspot") && audits.some((x) => x.a === "order.hubspot_failed"));
  const stuck = await db.select().from(schema.buyingDecisions).where(and(eq(schema.buyingDecisions.sinkRef, "sending")));
  check("no row is left stuck in 'sending'", stuck.length === 0, stuck.length);

  mock.close();
  summary();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 1 end-to-end: upload -> validate -> run -> AI -> review -> orders, plus role checks.
// Run against a server whose DATABASE_URL is a throwaway branch: npx tsx scripts/e2e-phase1.ts
import dotenv from "dotenv";
import { BASE, Session, check, sampleForm, section, summary } from "./e2e-lib";
import fs from "node:fs";

dotenv.config({ path: ".env.local", quiet: true });

async function main() {
  console.log(`Target: ${BASE}`);
  const raghav = await new Session("raghav").login();
  const procurement = await new Session("procurement").login();
  const priya = await new Session("priya").login();
  const deepa = await new Session("deepa").login();
  const ceo = await new Session("ceo").login();

  section("Validation");
  let r = await raghav.call("POST", "/api/runs/validate", sampleForm());
  check("sample data validates with no errors", r.json?.errors?.length === 0, r.json?.errors);
  check("sample data row counts are right", r.json?.rowCounts?.sales === 240 && r.json?.rowCounts?.sku === 15, r.json?.rowCounts);
  check("age check is skipped for sample data and says so", r.json?.warnings?.some((w: any) => w.code === "AGE_CHECK_SKIPPED"));

  // The same files uploaded as real data are stale (as-of 2026-10-19) and must be blocked.
  const real = new FormData();
  for (const [k, f] of Object.entries({ sku: "sku_master", distributor: "distributor_master", sales: "weekly_sales", inventory: "current_inventory", calendar: "calendar" })) {
    real.set(k, new Blob([fs.readFileSync(`seed/${f}.csv`)], { type: "text/csv" }), `${f}.csv`);
  }
  r = await raghav.call("POST", "/api/runs/validate", real);
  check("a real upload with stale inventory is blocked", r.json?.errors?.some((e: any) => e.code === "STALE_INVENTORY"), r.json?.errors);
  const real2 = new FormData();
  real2.set("sales", new Blob(["SKU_ID,Week,Units\nSKU001,2026-W42,5\n"]), "weekly_sales.csv");
  r = await raghav.call("POST", "/api/runs/validate", real2);
  check("missing files and columns are reported", r.json?.errors?.some((e: any) => e.code === "MISSING_COLUMN") && r.json?.errors?.some((e: any) => e.code === "MISSING_FILE"));
  const bad = new FormData();
  bad.set("sales", new Blob(["a,b\n1,2\n"]), "notes.txt");
  r = await raghav.call("POST", "/api/runs/validate", bad);
  check("non-csv files are refused", r.status === 400, r.json);

  section("Role checks on starting runs");
  for (const s of [procurement, priya, deepa, ceo]) {
    r = await s.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
    check(`${s.role} cannot start a run (403)`, r.status === 403, r.status);
  }
  r = await new Session("raghav").call("POST", "/api/runs", sampleForm());
  check("signed-out call is 401", r.status === 401, r.status);

  section("Run");
  r = await raghav.call("POST", "/api/runs", sampleForm());
  check("warnings must be acknowledged (422 needsAck)", r.status === 422 && r.json?.needsAck === true, r.status);
  r = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
  check("run is created with 7 flags", r.status === 200 && r.json?.flagged === 7, r.json);
  const runId = r.json.runId as number;

  section("AI step");
  r = await priya.call("POST", `/api/runs/${runId}/ai`);
  check("priya cannot run the AI step (403)", r.status === 403);
  r = await raghav.call("POST", `/api/runs/${runId}/ai`);
  check("AI step completes for all 7 flags", r.status === 200 && r.json?.total === 7, r.json);
  console.log(`       model=${r.json?.model} valid=${r.json?.valid} fallback=${r.json?.fallback}`);
  check("AI step cannot run twice (409)", (await raghav.call("POST", `/api/runs/${runId}/ai`)).status === 409);

  const { getDb, schema } = await import("../src/db");
  const { eq, asc } = await import("drizzle-orm");
  const db = getDb();
  const decisions = await db
    .select({ d: schema.aiDecisions, f: schema.flags })
    .from(schema.aiDecisions)
    .innerJoin(schema.flags, eq(schema.flags.id, schema.aiDecisions.flagId))
    .where(eq(schema.aiDecisions.runId, runId))
    .orderBy(asc(schema.flags.skuId));
  check("7 decisions stored", decisions.length === 7);
  const bySku = Object.fromEntries(decisions.map(({ d, f }) => [f.skuId, d]));
  check("SKU001 decision is REORDER 750", bySku.SKU001.action === "REORDER" && bySku.SKU001.quantity === 750, bySku.SKU001);
  check("AI never changed an action or quantity from the rules", decisions.every(({ d, f }) => d.action === f.ruleAction && d.quantity === f.ruleQty));

  section("Review: guardrails");
  const ids = decisions.map(({ d }) => d.id);
  for (const s of [procurement, priya, deepa, ceo]) {
    r = await s.call("POST", `/api/decisions/${ids[0]}/review`, { outcome: "accepted" });
    check(`${s.role} cannot review (403)`, r.status === 403, r.status);
  }
  r = await raghav.call("POST", `/api/decisions/${ids[0]}/review`, { outcome: "rejected", finalAction: "REORDER", finalQty: 999, finalFlagTypes: ["STOCKOUT_RISK"] });
  check("rejection without a reason code is refused", r.status === 400, r.json);
  r = await raghav.call("POST", `/api/decisions/${ids[0]}/review`, { outcome: "rejected", finalAction: bySku.SKU001.action, finalQty: bySku.SKU001.quantity, finalFlagTypes: ["HIGH_DEMAND", "STOCKOUT_RISK"], reasonCode: "WRONG_QUANTITY" });
  check("rejection with no change is refused", r.status === 400, r.json);
  r = await raghav.call("POST", `/api/decisions/${ids[0]}/review`, { outcome: "rejected", finalAction: "REORDER", finalQty: 0, reasonCode: "WRONG_QUANTITY" });
  check("a reorder with quantity 0 is refused", r.status === 400, r.json);
  r = await raghav.call("POST", `/api/decisions/${ids[0]}/review`, { outcome: "rejected", finalAction: "PAUSE_ORDER", finalQty: 40, reasonCode: "WRONG_ACTION" });
  check("a pause with quantity above 0 is refused", r.status === 400, r.json);
  r = await raghav.call("POST", `/api/decisions/${ids[0]}/review`, { outcome: "rejected", finalAction: "PAUSE_ORDER", finalQty: 0, reasonCode: "OTHER", reasonText: "" });
  check("reason OTHER needs text", r.status === 400, r.json);
  r = await raghav.call("POST", `/api/runs/${runId}/bulk-accept`, { decisionIds: [999999] });
  check("bulk accept with foreign ids is refused", r.status === 400, r.json);
  const nj = decisions.filter(({ d }) => d.needsJudgment || d.isFallback);
  if (nj.length) {
    r = await raghav.call("POST", `/api/runs/${runId}/bulk-accept`, { decisionIds: ids });
    check("bulk accept refuses needs-judgment or fallback rows", r.status === 400 && Array.isArray(r.json?.rejectedIds), r.json);
  }

  section("Review: accept 5, reject 2");
  const rejectIds = [decisions.find(({ f }) => f.skuId === "SKU003")!.d.id, decisions.find(({ f }) => f.skuId === "SKU006")!.d.id];
  const acceptIds = ids.filter((i) => !rejectIds.includes(i));
  for (const id of acceptIds) {
    r = await raghav.call("POST", `/api/decisions/${id}/review`, { outcome: "accepted" });
    check(`accept ${id}`, r.status === 200 && r.json?.buyingDecisionId > 0, r.json);
  }
  r = await raghav.call("POST", `/api/decisions/${rejectIds[0]}/review`, { outcome: "rejected", finalAction: "REORDER", finalQty: 450, finalFlagTypes: ["STOCKOUT_RISK"], reasonCode: "WRONG_QUANTITY", reasonText: "Distributor has a scheme" });
  check("reject SKU003 with a changed quantity", r.status === 200, r.json);
  r = await raghav.call("POST", `/api/decisions/${rejectIds[1]}/review`, { outcome: "rejected", finalAction: "NO_ACTION", finalQty: 0, finalFlagTypes: [], reasonCode: "DATA_LOOKS_WRONG", reasonText: "Count looks off" });
  check("reject SKU006 as NO_ACTION (run completes)", r.status === 200 && r.json?.buyingDecisionId === null && r.json?.runCompleted === true, r.json);
  r = await raghav.call("POST", `/api/decisions/${acceptIds[0]}/review`, { outcome: "accepted" });
  check("a decision cannot be reviewed twice (409)", r.status === 409, r.status);

  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  check("run is completed", run.status === "completed");
  const buying = await db.select().from(schema.buyingDecisions).where(eq(schema.buyingDecisions.runId, runId));
  check("6 buying decisions (NO_ACTION creates none)", buying.length === 6, buying.length);
  const changed = buying.find((b) => b.skuId === "SKU003");
  check("changed decision carries Raghav's quantity and reason", changed?.quantity === 450 && changed?.source === "raghav_changed" && changed?.reasonCode === "WRONG_QUANTITY", changed);
  const revs = await db.select().from(schema.reviews);
  check("Kill 1 counts a quantity change as a reversal, not a no-action flag change alone", revs.filter((x) => x.isReversal).length >= 2);

  section("Orders");
  r = await raghav.call("POST", `/api/orders/${buying[0].id}/placed`, {});
  check("raghav cannot mark orders placed (403)", r.status === 403);
  for (const b of buying) {
    r = await procurement.call("POST", `/api/orders/${b.id}/placed`, { orderRef: `PO-${b.id}` });
    check(`procurement marks ${b.skuId} placed`, r.status === 200, r.json);
  }
  r = await procurement.call("POST", `/api/orders/${buying[0].id}/placed`, {});
  check("placing twice is refused (409)", r.status === 409);
  r = await procurement.call("GET", "/api/orders/export");
  check("procurement can export CSV", r.status === 200 && r.text.startsWith("Run,SKU_ID"), r.text.slice(0, 80));
  r = await priya.call("GET", "/api/orders/export");
  check("priya cannot export orders (403)", r.status === 403);

  section("Audit trail");
  const audits = await db.select().from(schema.auditLog);
  for (const a of ["run.created", "run.ai_done", "review.saved", "run.completed", "order.placed", "auth.login"]) {
    check(`audit has ${a}`, audits.some((x) => x.action === a));
  }

  summary();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

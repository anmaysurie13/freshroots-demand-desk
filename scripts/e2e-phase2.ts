/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 2 end-to-end: loss entry, both kill switches at their boundaries, what a kill does, re-arm rules, cron, audit.
// Run against a server on a THROWAWAY database branch: npx tsx scripts/e2e-phase2.ts
import dotenv from "dotenv";
import { BASE, Session, check, sampleForm, section, summary } from "./e2e-lib";

dotenv.config({ path: ".env.local", quiet: true });

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const [Y, M] = TODAY.split("-").map(Number);
const QSTART = `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
const QMID = `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-28`;

async function main() {
  console.log(`Target: ${BASE}  today(IST)=${TODAY}`);
  const { getDb, schema } = await import("../src/db");
  const { eq, sql, and, desc } = await import("drizzle-orm");
  const kill = await import("../src/lib/server/kill");
  const db = getDb();

  const raghav = await new Session("raghav").login();
  const procurement = await new Session("procurement").login();
  const priya = await new Session("priya").login();
  const deepa = await new Session("deepa").login();
  const ceo = await new Session("ceo").login();
  const admin = await new Session("admin").login();

  // ---- test setup on the throwaway branch: clean slate for the two monitors
  await db.update(schema.killState).set({ kill1State: "armed", kill2State: "green", kill1EpochStart: new Date() }).where(eq(schema.killState.id, 1));
  await db.delete(schema.lossEntries);

  const state = async () => (await db.select().from(schema.killState).where(eq(schema.killState.id, 1)))[0];

  async function newRun(): Promise<{ runId: number; ids: number[]; skus: Record<string, number> }> {
    let r = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
    if (r.status !== 200) throw new Error(`run failed: ${r.status} ${JSON.stringify(r.json)}`);
    const runId = r.json.runId as number;
    r = await raghav.call("POST", `/api/runs/${runId}/ai`);
    if (r.status !== 200) throw new Error(`ai failed: ${r.status} ${JSON.stringify(r.json)}`);
    const rows = await db
      .select({ id: schema.aiDecisions.id, sku: schema.flags.skuId })
      .from(schema.aiDecisions)
      .innerJoin(schema.flags, eq(schema.flags.id, schema.aiDecisions.flagId))
      .where(eq(schema.aiDecisions.runId, runId));
    return { runId, ids: rows.map((x) => x.id), skus: Object.fromEntries(rows.map((x) => [x.sku, x.id])) };
  }
  const accept = (id: number) => raghav.call("POST", `/api/decisions/${id}/review`, { outcome: "accepted" });
  const reverse = (id: number) => raghav.call("POST", `/api/decisions/${id}/review`, { outcome: "rejected", finalAction: "REORDER", finalQty: 12345, reasonCode: "WRONG_QUANTITY" });

  // =================================================================== KILL 1
  section("Kill 1: reversal monitor, through the real review flow");
  const reviewedCount = async () => (await kill.kill1Counts(db, (await state()).kill1EpochStart));

  // Run 1: 4 reversals + 3 accepts. Runs 2-4: all accepted. That is 28 reviewed, 4 reversed (14%).
  const runs: { runId: number; ids: number[]; skus: Record<string, number> }[] = [];
  const r1 = await newRun();
  runs.push(r1);
  const reverseIds = [r1.skus.SKU001, r1.skus.SKU003, r1.skus.SKU004, r1.skus.SKU011];
  for (const id of reverseIds) check(`reverse ${id}`, (await reverse(id)).status === 200);
  for (const id of r1.ids.filter((i) => !reverseIds.includes(i))) check(`accept ${id}`, (await accept(id)).status === 200);
  for (let i = 0; i < 3; i++) {
    const r = await newRun();
    runs.push(r);
    for (const id of r.ids) await accept(id);
  }
  let c = await reviewedCount();
  check("28 reviewed, 4 reversed, collecting data (below the 30 minimum)", c.reviewed === 28 && c.reversed === 4 && c.collecting && !c.fire, c);
  check("Kill 1 has not fired at 28 reviewed even though 14% is above 10%", (await state()).kill1State === "armed");

  // Fallback decisions are excluded from the count.
  const [probe] = await db.select({ id: schema.aiDecisions.id }).from(schema.aiDecisions).where(eq(schema.aiDecisions.runId, runs[1].runId)).limit(1);
  await db.update(schema.aiDecisions).set({ isFallback: true }).where(eq(schema.aiDecisions.id, probe.id));
  c = await reviewedCount();
  check("a fallback decision is excluded from the reviewed count", c.reviewed === 27, c);
  await db.update(schema.aiDecisions).set({ isFallback: false }).where(eq(schema.aiDecisions.id, probe.id));

  // Run 5: the 29th review must not fire; the 30th must.
  const r5 = await newRun();
  runs.push(r5);
  let resp = await accept(r5.ids[0]);
  check("29th review: Kill 1 does not fire", resp.status === 200 && resp.json.killFired === false && (await state()).kill1State === "armed", resp.json);
  const stuckBefore = r5.ids.slice(2);
  resp = await accept(r5.ids[1]);
  check("30th review at 13.3%: Kill 1 fires", resp.status === 200 && resp.json.killFired === true, resp.json);
  check("kill state is killed", (await state()).kill1State === "killed");

  section("What a kill does");
  const voided = await db.select().from(schema.aiDecisions).where(and(eq(schema.aiDecisions.runId, r5.runId), eq(schema.aiDecisions.status, "voided_by_kill")));
  check("unreviewed AI decisions are voided", voided.length === stuckBefore.length && voided.length === 5, voided.length);
  const pendingBuying = await db.select().from(schema.buyingDecisions).where(eq(schema.buyingDecisions.status, "pending"));
  const heldBuying = await db.select().from(schema.buyingDecisions).where(eq(schema.buyingDecisions.status, "held"));
  check("unplaced buying decisions are held, not cancelled", pendingBuying.length === 0 && heldBuying.length > 0, { pending: pendingBuying.length, held: heldBuying.length });
  const [run5] = await db.select().from(schema.runs).where(eq(schema.runs.id, r5.runId));
  check("the in-flight run is blocked", run5.status === "blocked", run5.status);
  resp = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
  check("new runs are blocked (409)", resp.status === 409, resp.json);
  resp = await accept(stuckBefore[0]);
  check("a voided decision cannot be reviewed (409)", resp.status === 409, resp.json);
  resp = await raghav.call("POST", `/api/runs/${r5.runId}/ai`);
  check("the AI step is blocked (409)", resp.status === 409, resp.json);
  resp = await raghav.call("POST", "/api/runs/validate", sampleForm());
  check("validation reports the stop", resp.json?.blocked === true, resp.json);
  for (const s of [raghav, procurement, priya, deepa, ceo, admin]) {
    const html = (await s.call("GET", "/dashboard")).text;
    check(`${s.role}: banner is on the dashboard`, html.includes("Automation stopped"));
  }
  check("banner is on the Orders page too", (await procurement.call("GET", "/orders")).text.includes("Automation stopped"));
  const emailsK1 = await db.select().from(schema.emailOutbox).where(sql`${schema.emailOutbox.subject} like 'Kill 1 fired%'`);
  check("Kill 1 emailed Raghav, Deepa, CEO and Priya", new Set(emailsK1.map((e) => e.toRole)).size === 4, emailsK1.map((e) => e.toRole));

  section("Kill 1: idempotent");
  const before = (await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 1), eq(schema.killEvents.event, "killed")))).length;
  await kill.evaluateKill1AfterReview(null);
  await kill.evaluateKill1AfterReview(null);
  const after = (await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 1), eq(schema.killEvents.event, "killed")))).length;
  check("evaluating twice while killed writes no new event", before === after && before === 1, { before, after });

  section("Re-arm rules for Kill 1");
  for (const s of [raghav, procurement, priya, admin]) {
    resp = await s.call("POST", "/api/kill/rearm", { switch: 1, reason: "a long enough written reason here" });
    check(`${s.role} cannot re-arm (403)`, resp.status === 403, resp.status);
  }
  resp = await deepa.call("POST", "/api/kill/rearm", { switch: 1, reason: "too short" });
  check("a reason under 20 characters is refused (400)", resp.status === 400, resp.json);
  resp = await deepa.call("POST", "/api/kill/rearm", { switch: 2, reason: "a long enough written reason here" });
  check("re-arming a switch that is not killed is refused (409)", resp.status === 409, resp.json);
  resp = await deepa.call("POST", "/api/kill/rearm", { switch: 1, reason: "Reviewed the four reversals with Raghav; rule change agreed." });
  check("deepa re-arms Kill 1 with a reason", resp.status === 200, resp.json);
  c = await reviewedCount();
  check("count restarts from zero after the re-arm", c.reviewed === 0 && c.reversed === 0 && c.collecting, c);
  check("kill state is armed again", (await state()).kill1State === "armed");
  resp = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
  check("new runs work again", resp.status === 200, resp.json);
  const past = await db.select().from(schema.reviews);
  check("past reviews are kept after the re-arm", past.length >= 30);

  // ===================================================================== LOSS
  section("Loss entry: access and validation");
  const body = (so: number, ov: number, start = QSTART, end = QMID) => ({ periodStart: start, periodEnd: end, stockoutLoss: so, overstockWriteoff: ov });
  for (const s of [raghav, procurement, deepa, ceo, admin]) {
    resp = await s.call("POST", "/api/loss", body(1, 1));
    check(`${s.role} cannot enter loss (403)`, resp.status === 403, resp.status);
  }
  resp = await priya.call("POST", "/api/loss", body(-5, 0));
  check("negative amount is refused", resp.status === 400, resp.json);
  resp = await priya.call("POST", "/api/loss", { ...body(1, 1), periodStart: QMID, periodEnd: QSTART });
  check("end before start is refused", resp.status === 400, resp.json);
  resp = await priya.call("POST", "/api/loss", { ...body(1, 1), periodStart: "2026-09-15", periodEnd: "2026-10-15" });
  check("a period that crosses a quarter is refused", resp.status === 400, resp.json);

  // ===================================================================== KILL 2
  section("Kill 2: outcome gate boundaries");
  const k2state = async () => (await state()).kill2State;
  resp = await priya.call("POST", "/api/loss", body(2000000, 800000));
  check("Rs 28,00,000 exactly: green", resp.status === 200 && resp.json.kill.state === "green" && (await k2state()) === "green", resp.json);
  resp = await priya.call("POST", "/api/loss", body(2000001, 800000));
  check("Rs 28,00,001: alert (entry edited)", resp.json.edited === true && resp.json.kill.state === "alert" && (await k2state()) === "alert", resp.json);
  const mailAlert = await db.select().from(schema.emailOutbox).where(sql`${schema.emailOutbox.subject} like 'Kill 2 alert%'`);
  check("alert email queued for Raghav, Deepa and the CEO", new Set(mailAlert.map((e) => e.toRole)).size === 3 && !mailAlert.some((e) => e.toRole === "priya"), mailAlert.map((e) => e.toRole));
  resp = await priya.call("POST", "/api/loss", body(2000000, 800000));
  check("edited back down to Rs 28,00,000: green again", resp.json.kill.state === "green" && (await k2state()) === "green", resp.json);
  resp = await priya.call("POST", "/api/loss", body(2600000, 800000));
  check("Rs 34,00,000 exactly: alert", resp.json.kill.state === "alert" && (await k2state()) === "alert", resp.json);
  const alertsBefore = (await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 2), eq(schema.killEvents.event, "alert")))).length;
  await kill.evaluateKill2Now(null);
  await kill.evaluateKill2Now(null);
  const alertsAfter = (await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 2), eq(schema.killEvents.event, "alert")))).length;
  check("evaluating twice in alert writes no new alert event", alertsBefore === alertsAfter);

  section("Kill 2: entries split across records sum correctly");
  resp = await priya.call("POST", "/api/loss", body(2600000, 700000)); // A = 33,00,000
  check("A: Rs 33,00,000 stays alert", resp.json.kill.state === "alert", resp.json);
  resp = await priya.call("POST", "/api/loss", { ...body(60000, 40000, `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-29`, `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-30`) });
  check("B: another Rs 1,00,000 is added => Rs 34,00,000 total, still alert", resp.json.kill.state === "alert" && resp.json.kill.total === 3400000, resp.json);

  // New run to hold: create flags, review some so there are pending buying decisions and unreviewed decisions.
  const live = await newRun();
  await accept(live.ids[0]);
  await accept(live.ids[1]);

  section("Kill 2 fires at Rs 34,00,001");
  resp = await priya.call("POST", "/api/loss", { ...body(1, 0, `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-29`, `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-30`), stockoutLoss: 60001, overstockWriteoff: 40000 });
  check("Rs 34,00,001: killed", resp.json.kill.state === "killed" && (await k2state()) === "killed", resp.json);
  const v2 = await db.select().from(schema.aiDecisions).where(and(eq(schema.aiDecisions.runId, live.runId), eq(schema.aiDecisions.status, "voided_by_kill")));
  check("unreviewed decisions voided by Kill 2", v2.length === live.ids.length - 2, v2.length);
  const h2 = await db.select().from(schema.buyingDecisions).where(and(eq(schema.buyingDecisions.runId, live.runId), eq(schema.buyingDecisions.status, "held")));
  check("the 2 accepted decisions became held buying decisions", h2.length === 2, h2.length);
  resp = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
  check("new runs blocked by Kill 2", resp.status === 409);
  check("banner is shown after Kill 2", (await ceo.call("GET", "/review")).text.includes("Automation stopped"));

  section("Held orders need confirmation");
  resp = await procurement.call("POST", `/api/orders/${h2[0].id}/placed`, {});
  check("placing a held item without confirming with Raghav is refused", resp.status === 400, resp.json);
  resp = await procurement.call("POST", `/api/orders/${h2[0].id}/placed`, { confirmedWithRaghav: true, orderRef: "PO-HELD-1" });
  check("with the confirmation it can be placed", resp.status === 200, resp.json);

  section("A killed state survives a quarter rollover");
  const nextQuarter = `${Y + 1}-01-05`;
  const roll = await kill.evaluateKill2Now(null, nextQuarter);
  check("evaluating in the next quarter leaves it killed", roll.state === "killed" && roll.changed === false, roll);
  check("the new quarter's loss does not include the old entries", roll.total === 0, roll);
  const killedEvents = (await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 2), eq(schema.killEvents.event, "killed")))).length;
  await kill.evaluateKill2Now(null);
  await kill.evaluateKill2Now(null);
  const killedEvents2 = (await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 2), eq(schema.killEvents.event, "killed")))).length;
  check("Kill 2 is idempotent: repeated evaluation creates one killed event", killedEvents === 1 && killedEvents2 === 1, { killedEvents, killedEvents2 });

  section("Re-arm Kill 2");
  resp = await deepa.call("POST", "/api/kill/rearm", { switch: 2, reason: "Reviewed the quarter's losses with the CEO today." });
  check("warned that it will fire again (409 needsConfirm)", resp.status === 409 && resp.json?.needsConfirm === true, resp.json);
  resp = await deepa.call("POST", "/api/kill/rearm", { switch: 2, reason: "Reviewed the quarter's losses with the CEO today.", confirmRefire: true });
  check("confirmed re-arm fires again at once while loss is above Rs 34L", resp.status === 200 && resp.json.refired === true && (await k2state()) === "killed", resp.json);
  resp = await priya.call("POST", "/api/loss", body(2000000, 800000));
  check("Priya corrects entry A down: the state stays killed until re-armed", resp.json.kill.state === "killed" && (await k2state()) === "killed", resp.json);
  resp = await priya.call("POST", "/api/loss", { ...body(0, 0, `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-29`, `${Y}-${String(Math.floor((M - 1) / 3) * 3 + 1).padStart(2, "0")}-30`) });
  resp = await deepa.call("POST", "/api/kill/rearm", { switch: 2, reason: "Loss entries were corrected; re-arming after review." });
  check("re-arm succeeds once the loss is below the kill level", resp.status === 200 && resp.json.refired === false, resp.json);
  check("state is no longer killed", (await k2state()) !== "killed", await k2state());
  resp = await raghav.call("POST", "/api/runs", sampleForm({ ackWarnings: "true" }));
  check("new runs work again after Kill 2 re-arm", resp.status === 200, resp.json);

  section("Alert acknowledgement");
  const [alertEv] = await db.select().from(schema.killEvents).where(and(eq(schema.killEvents.switch, 2), eq(schema.killEvents.event, "alert"))).orderBy(desc(schema.killEvents.id)).limit(1);
  resp = await priya.call("POST", "/api/kill/ack", { eventId: alertEv.id });
  check("priya cannot acknowledge (403)", resp.status === 403);
  resp = await deepa.call("POST", "/api/kill/ack", { eventId: alertEv.id });
  check("deepa acknowledges the alert", resp.status === 200, resp.json);
  resp = await deepa.call("POST", "/api/kill/ack", { eventId: alertEv.id });
  check("a second acknowledgement is refused (409)", resp.status === 409);

  section("Cron route");
  let r = await fetch(`${BASE}/api/cron/kill2`);
  check("no token: 401", r.status === 401);
  r = await fetch(`${BASE}/api/cron/kill2`, { headers: { Authorization: "Bearer wrong" } });
  check("wrong token: 401", r.status === 401);
  r = await fetch(`${BASE}/api/cron/kill2`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  check("correct token: 200 with a state", r.status === 200 && ["green", "alert", "killed"].includes((await r.json()).state));

  section("Page access by role");
  for (const [s, path, want] of [
    [raghav, "/audit", false],
    [procurement, "/settings", false],
    [deepa, "/audit", true],
    [admin, "/audit", true],
    [admin, "/settings", true],
    [deepa, "/settings", false],
    [raghav, "/run/new", true],
    [priya, "/run/new", false],
  ] as const) {
    const page = await fetch(`${BASE}${path}`, { headers: { Cookie: s.cookie }, redirect: "manual" });
    const ok = want ? page.status === 200 : page.status >= 300 && page.status < 400;
    check(`${s.role} ${want ? "can open" : "is redirected from"} ${path}`, ok, page.status);
  }
  for (const [path, label] of [["/dashboard", "dashboard"], ["/kill", "safety"], ["/orders", "orders"], ["/review", "review"]] as const) {
    const page = await fetch(`${BASE}${path}`, { headers: { Cookie: priya.cookie } });
    check(`${label} page renders (200)`, page.status === 200, page.status);
  }
  r = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
  check("signed out: dashboard redirects to login", r.status >= 300 && r.status < 400);

  section("Metrics export");
  resp = await priya.call("GET", "/api/metrics/export");
  check("priya can export metrics", resp.status === 200 && resp.text.includes("Quarter-to-date loss"), resp.status);
  resp = await deepa.call("GET", "/api/metrics/export");
  check("deepa cannot export metrics (403)", resp.status === 403);

  section("Users");
  resp = await deepa.call("POST", "/api/users", { name: "X Y", email: "x@y.example", role: "ceo", password: "long-enough-password" });
  check("only admin can create accounts (403)", resp.status === 403);
  const stamp = Date.now();
  resp = await admin.call("POST", "/api/users", { name: "Temp User", email: `temp${stamp}@freshroots.example`, role: "procurement", password: "a-long-temp-password-1" });
  check("admin creates an account", resp.status === 200, resp.json);
  resp = await admin.call("PATCH", `/api/users/${resp.json.id}`, { active: false });
  check("admin deactivates it", resp.status === 200);
  resp = await new Session("raghav").call("POST", "/api/auth/login", { email: `temp${stamp}@freshroots.example`, password: "a-long-temp-password-1" });
  check("a deactivated account cannot sign in", resp.status === 401);
  const wrong = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "raghav@freshroots.example", password: "wrong" }) });
  check("a wrong password is refused (401)", wrong.status === 401);

  section("Audit trail covers every state change");
  const actions = new Set((await db.select({ a: schema.auditLog.action }).from(schema.auditLog)).map((x) => x.a));
  for (const a of ["run.created", "run.ai_done", "review.saved", "order.placed", "loss.entered", "loss.edited", "kill1.fired", "kill1.rearmed", "kill2.alert", "kill2.fired", "kill2.rearmed", "kill2.alert_acknowledged", "kill2.cleared", "user.created", "user.deactivated", "metrics.exported"]) {
    check(`audit has ${a}`, actions.has(a));
  }

  summary();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

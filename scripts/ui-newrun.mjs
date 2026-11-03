// Browser test of the New Run screen, clicking like a user. Run against a server on a throwaway DB branch.
// Usage: node scripts/ui-newrun.mjs [baseUrl]
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
let failed = 0;
const ok = (name, cond, detail) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? "  -> " + JSON.stringify(detail) : ""}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const errors = [];

async function raghav(viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 140)));
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[data-role=raghav]")]);
  await page.goto(`${base}/run/new`, { waitUntil: "networkidle" });
  return { ctx, page };
}
const tracker = (page) => page.locator(".tracker li").evaluateAll((els) => els.map((e) => ({ title: e.querySelector("div > div")?.textContent?.trim(), cls: e.className, text: e.textContent })));

console.log("\nSample data: validate, then start");
{
  const { ctx, page } = await raghav();
  const start = page.getByRole("button", { name: /Start run/ });
  ok("no report and no Start run before validating", (await start.count()) === 0);
  await page.getByRole("button", { name: "Use sample data" }).click();
  await page.getByRole("button", { name: "Validate files" }).click();
  await page.waitForSelector("text=Validation report");
  await page.waitForTimeout(700);
  ok("Start run is disabled until the warnings are ticked", await start.isDisabled());
  ok("the prompt says what to do", (await page.getByText("Tick the box above to enable Start run.").count()) === 1);
  let t = await tracker(page);
  ok("Upload and Validate are done", t[0].cls.includes("done") && t[1].cls.includes("done"), t.map((x) => x.cls));
  ok("Forecast and flag is NOT shown as running", !t[2].cls.includes("active"), t[2].cls);
  ok("it tells you the next action", t[2].text.includes("Tick the warnings box, then press Start run"), t[2].text);
  const inView = await page.locator("text=Validation report").evaluate((el) => el.getBoundingClientRect().top < window.innerHeight && el.getBoundingClientRect().bottom > 0);
  ok("the report was scrolled into view", inView);

  await page.getByLabel("I have read the warnings and want to continue.").check();
  ok("ticking enables Start run", await start.isEnabled());
  t = await tracker(page);
  ok("hint changes to 'Press Start run'", t[2].text.includes("Press Start run to continue"), t[2].text);

  await start.click();
  await page.waitForTimeout(1200);
  t = await tracker(page);
  ok("while working, Forecast/AI step shows as active with 'Working...'", t.some((x) => x.cls.includes("active") && x.text.includes("Working")), t.map((x) => x.cls));
  await page.waitForURL(/\/review\?run=\d+/, { timeout: 120000 });
  ok("lands on the Review page for the new run", /\/review\?run=\d+/.test(page.url()), page.url());
  await page.waitForSelector("text=AI decision, pending your review", { timeout: 20000 });
  const cards = await page.locator("article").count();
  ok("Review shows the 7 AI decisions", cards === 7, cards);
  ok("none is marked fallback", (await page.getByText("AI unavailable").count()) === 0);
  await ctx.close();
}

console.log("\nReal files (stale inventory): errors block");
{
  const { ctx, page } = await raghav();
  const dir = "seed/";
  const map = { sales: "weekly_sales.csv", inventory: "current_inventory.csv", sku: "sku_master.csv", distributor: "distributor_master.csv", calendar: "calendar.csv" };
  const inputs = page.locator("input[type=file]");
  const order = ["sales", "inventory", "sku", "distributor", "calendar"];
  for (let i = 0; i < order.length; i++) await inputs.nth(i).setInputFiles(dir + map[order[i]]);
  await page.getByRole("button", { name: "Validate files" }).click();
  await page.waitForSelector("text=Validation report");
  await page.waitForTimeout(500);
  ok("a stale-inventory error is listed", (await page.getByText("days old at upload").count()) >= 1);
  ok("Start run stays disabled when errors exist", await page.getByRole("button", { name: /Start run/ }).isDisabled());
  const t = await tracker(page);
  ok("tracker says to fix the errors", t[1].text.includes("Fix the errors") || t.some((x) => x.text.includes("Fix the errors")), t.map((x) => x.text));
  await ctx.close();
}

console.log("\nPhone layout");
{
  const { ctx, page } = await raghav({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use sample data" }).click();
  await page.getByRole("button", { name: "Validate files" }).click();
  await page.waitForSelector("text=Validation report");
  ok("no horizontal overflow on a phone", (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await ctx.close();
}

await browser.close();
console.log(errors.length ? `\nconsole errors: ${[...new Set(errors)].join(" | ")}` : "\nNo console or page errors.");
console.log(failed ? `\n${failed} FAILED` : "\nAll UI checks passed");
process.exit(failed ? 1 : 0);

// Visual check: opens the role picker, enters as roles, and saves screenshots. Usage: node scripts/shots.mjs <outDir> [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const out = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3000";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const errors = [];

async function enter(role, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  return { ctx, page };
}

for (const [tag, viewport] of [["desktop", { width: 1360, height: 860 }], ["phone", { width: 390, height: 844 }]]) {
  let { ctx, page } = await enter("none", viewport);
  await page.screenshot({ path: path.join(out, `${tag}-picker.png`), fullPage: true });
  console.log(`${tag} picker: password fields = ${await page.locator("input[type=password]").count()}, role buttons = ${await page.locator("button[data-role]").count()}`);
  await ctx.close();
}

for (const [role, url, name] of [["procurement", "/orders", "orders"], ["raghav", "/review", "review"], ["deepa", "/kill", "safety"]]) {
  const { ctx, page } = await enter(role, { width: 1360, height: 860 });
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click(`button[data-role=${role}]`)]);
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `desktop-${role}-${name}.png`), fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await enter("procurement", { width: 390, height: 844 });
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[data-role=procurement]")]);
  await page.goto(`${base}/orders`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(out, "phone-orders.png"), fullPage: false });
  console.log(`phone orders overflow: ${await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)}px`);
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `errors: ${[...new Set(errors)].join(" | ")}` : "No console or page errors.");

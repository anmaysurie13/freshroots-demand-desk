// Visual check of a populated Review screen, the reject drawer and a phone layout. Prints no secrets.
// Usage: node scripts/shots2.mjs <outDir> <runId> [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [out, runId, base = "http://localhost:3000"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const creds = {};
for (const line of fs.readFileSync(".seed-credentials.txt", "utf8").split("\n")) {
  const [role, email, password] = line.trim().split(/\s+/);
  if (role && password) creds[role] = { email, password };
}
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

async function login(viewport, role) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill("#email", creds[role].email);
  await page.fill("#password", creds[role].password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  return { ctx, page };
}

let { ctx, page } = await login({ width: 1360, height: 900 }, "raghav");
await page.goto(`${base}/review?run=${runId}`, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(out, "review-desktop.png"), fullPage: false });
await page.getByRole("button", { name: "Reject" }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, "reject-drawer.png") });
await ctx.close();

({ ctx, page } = await login({ width: 390, height: 844 }, "raghav"));
await page.goto(`${base}/review?run=${runId}`, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(out, "review-phone.png"), fullPage: false });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log(`review phone horizontal overflow: ${overflow}px`);
await page.goto(`${base}/orders`, { waitUntil: "networkidle" });
console.log(`orders (raghav) phone horizontal overflow: ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}px`);
await ctx.close();

({ ctx, page } = await login({ width: 390, height: 844 }, "procurement"));
await page.goto(`${base}/orders`, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(out, "orders-phone.png"), fullPage: false });
console.log(`orders (procurement) phone horizontal overflow: ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}px`);
for (const p of ["/dashboard", "/kill"]) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  console.log(`${p} phone horizontal overflow: ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}px`);
}
await ctx.close();
await browser.close();

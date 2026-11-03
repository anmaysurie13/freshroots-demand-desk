// Visual check: signs in per role in a headless installed browser and saves screenshots. Prints no secrets.
// Usage: node scripts/shots.mjs <outDir> [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const out = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3000";
fs.mkdirSync(out, { recursive: true });

const creds = {};
for (const line of fs.readFileSync(".seed-credentials.txt", "utf8").split("\n")) {
  const [role, email, password] = line.trim().split(/\s+/);
  if (role && password) creds[role] = { email, password };
}

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

async function shotsFor(role, pages, viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  await page.goto(`${base}/login`);
  await page.fill("#email", creds[role].email);
  await page.fill("#password", creds[role].password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }), page.click("button[type=submit]")]);
  for (const [name, url, full] of pages) {
    await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `${tag}-${role}-${name}.png`), fullPage: full ?? false });
  }
  await ctx.close();
  return errors;
}

const desktop = { width: 1360, height: 860 };
const phone = { width: 390, height: 844 };
const all = [];
all.push(...(await shotsFor("raghav", [["review", "/review", true], ["newrun", "/run/new", true]], desktop, "d")));
all.push(...(await shotsFor("procurement", [["orders", "/orders", true]], desktop, "d")));
all.push(...(await shotsFor("priya", [["dashboard", "/dashboard", true]], desktop, "d")));
all.push(...(await shotsFor("deepa", [["safety", "/kill", true], ["audit", "/audit", false]], desktop, "d")));
all.push(...(await shotsFor("admin", [["settings", "/settings", false]], desktop, "d")));
all.push(...(await shotsFor("raghav", [["review", "/review", false]], phone, "m")));
all.push(...(await shotsFor("procurement", [["orders", "/orders", false]], phone, "m")));
await browser.close();
console.log(all.length ? `Console/page errors:\n${[...new Set(all)].join("\n")}` : "No console or page errors.");

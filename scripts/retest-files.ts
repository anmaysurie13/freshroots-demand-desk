// Runs a folder of the five SAP CSVs through the real validator and rule engine and checks the spec's expected result.
// Usage: npx tsx scripts/retest-files.ts "<folder with the five csv files>"
import fs from "node:fs";
import path from "node:path";
import { rulesConfig } from "../src/lib/config";
import { runRuleEngine } from "../src/lib/engine/rules";
import { validateFiles } from "../src/lib/validation/validate";

const dir = process.argv[2];
if (!dir) throw new Error("Pass the folder that holds the five CSV files.");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
const files = {
  sku: read("sku_master.csv"),
  distributor: read("distributor_master.csv"),
  sales: read("weekly_sales.csv"),
  inventory: read("current_inventory.csv"),
  calendar: read("calendar.csv"),
};

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? "  -> " + JSON.stringify(detail) : ""}`);
  if (!ok) failed++;
};

console.log(`Files read from: ${dir}`);

console.log("\nValidated as of the upload day (2026-10-20, one day after the inventory date)");
const v = validateFiles(files, { now: new Date("2026-10-20T06:00:00Z") }, rulesConfig);
check("no validation errors", v.errors.length === 0, v.errors);
check("row counts: sales 240, inventory 15, SKUs 15, distributors 4, calendar 24", v.rowCounts.sales === 240 && v.rowCounts.inventory === 15 && v.rowCounts.sku === 15 && v.rowCounts.distributor === 4 && v.rowCounts.calendar === 24, v.rowCounts);
check("as-of 2026-10-19, last complete week 2026-W42", v.asOfDate === "2026-10-19" && v.lastCompleteWeek === "2026-W42");
check("only warning is the SKU006 stock-versus-peak note", v.warnings.length === 1 && v.warnings[0].code === "STOCK_VS_PEAK", v.warnings.map((w) => w.code));

const p = v.parsed!;
const out = runRuleEngine({ asOfDate: p.asOfDate, skus: p.skus, sales: p.sales, inventory: p.inventory, isFestival: p.isFestival }, rulesConfig);
console.log("\nRule engine result (October is a festival month, uplift 1.25)");
check("festival uplift applied", out.uplift === 1.25);
const expected: Record<string, [string[], number, string, number]> = {
  SKU001: [["HIGH_DEMAND", "STOCKOUT_RISK"], 3.35, "REORDER", 750],
  SKU003: [["STOCKOUT_RISK"], 4.36, "REORDER", 300],
  SKU004: [["STOCKOUT_RISK"], 1.8, "REORDER", 150],
  SKU006: [["OVERSTOCK_RISK"], 22.23, "PAUSE_ORDER", 0],
  SKU007: [["OVERSTOCK_RISK"], 4.08, "PAUSE_ORDER", 0],
  SKU011: [["STOCKOUT_RISK"], 1.8, "REORDER", 500],
  SKU013: [["STOCKOUT_RISK"], 3.17, "REORDER", 120],
};
check("exactly 7 flagged SKUs", out.flags.length === 7 && out.flags.map((f) => f.skuId).join() === Object.keys(expected).join(), out.flags.map((f) => f.skuId));
for (const f of out.flags) {
  const [flags, cover, action, qty] = expected[f.skuId] ?? [[], 0, "", 0];
  const ok = f.flagTypes.join() === flags.join() && Math.round((f.coverWeeks ?? 0) * 100) / 100 === cover && f.ruleAction === action && f.ruleQty === qty;
  check(`${f.skuId}: ${f.flagTypes.join(" + ")}, cover ${f.coverWeeks?.toFixed(2)} wk, ${f.ruleAction} ${f.ruleQty}`, ok, { flags: f.flagTypes, cover: f.coverWeeks, action: f.ruleAction, qty: f.ruleQty });
}
check("8 SKUs unflagged (002, 005, 008, 009, 010, 012, 014, 015)", out.unflagged === 8);

console.log("\nValidated as of today, as a real upload");
const today = validateFiles(files, { now: new Date() }, rulesConfig);
const stale = today.errors.find((e) => e.code === "STALE_INVENTORY");
check("refused as stale inventory (older than 7 days), by design", !!stale, today.errors.map((e) => e.code));
if (stale) console.log(`       "${stale.message}"`);
const sample = validateFiles(files, { now: new Date(), skipAgeCheck: true }, rulesConfig);
check("the same files pass through the sample-data path (age check skipped, shown as a warning)", sample.errors.length === 0 && sample.warnings.some((w) => w.code === "AGE_CHECK_SKIPPED"));

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

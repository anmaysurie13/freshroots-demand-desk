import fs from "node:fs";
import path from "node:path";
import { rulesConfig, type RulesConfig } from "../src/lib/config";
import { runRuleEngine } from "../src/lib/engine/rules";
import type { EngineInput, Perishability, SkuMaster } from "../src/lib/engine/types";
import { shiftWeek } from "../src/lib/engine/weeks";
import { validateFiles, type FileKey } from "../src/lib/validation/validate";

const SEED = path.join(__dirname, "..", "seed");

export function seedFiles(): Record<FileKey, string> {
  const read = (f: string) => fs.readFileSync(path.join(SEED, f), "utf8");
  return {
    sku: read("sku_master.csv"),
    distributor: read("distributor_master.csv"),
    sales: read("weekly_sales.csv"),
    inventory: read("current_inventory.csv"),
    calendar: read("calendar.csv"),
  };
}

/** A moment inside the seed data's 7-day freshness window. */
export const SEED_NOW = new Date("2026-10-20T06:00:00Z");

export function seedEngineInput(files = seedFiles()): EngineInput {
  const report = validateFiles(files, { now: SEED_NOW }, rulesConfig);
  if (!report.parsed) throw new Error("Seed data failed validation: " + JSON.stringify(report.errors));
  const p = report.parsed;
  return { asOfDate: p.asOfDate, skus: p.skus, sales: p.sales, inventory: p.inventory, isFestival: p.isFestival };
}

export function cfgWith(patch: (c: RulesConfig) => void): RulesConfig {
  const c = structuredClone(rulesConfig);
  patch(c);
  return c;
}

/**
 * One-SKU synthetic input. Weekly sales are `base` for the 8 older weeks and `recent` for the last 4.
 * As-of is Monday 2026-10-19 (last complete week 2026-W42) and the month is non-festival unless asked.
 */
export function synthetic(opts: {
  base: number;
  recent: number;
  onHand: number;
  perishability?: Perishability;
  festival?: boolean;
  qty?: number;
}): EngineInput {
  const sku: SkuMaster = {
    skuId: "SYN1",
    name: "Synthetic",
    category: "Test",
    perishability: opts.perishability ?? "Low",
    standardQty: opts.qty ?? 100,
    uom: "Units",
    distributorId: "D1",
  };
  const sales = [];
  for (let i = 0; i < 12; i++) {
    sales.push({ skuId: "SYN1", week: shiftWeek("2026-W42", i - 11), units: i < 8 ? opts.base : opts.recent });
  }
  return {
    asOfDate: "2026-10-19",
    skus: [sku],
    sales,
    inventory: [{ skuId: "SYN1", location: "X", unitsOnHand: opts.onHand, asOfDate: "2026-10-19" }],
    isFestival: opts.festival ?? false,
  };
}

export function flagsFor(input: EngineInput, cfg = rulesConfig) {
  return runRuleEngine(input, cfg).flags;
}

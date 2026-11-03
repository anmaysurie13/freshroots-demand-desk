import { describe, expect, it } from "vitest";
import { rulesConfig } from "../src/lib/config";
import { validateFiles, type FileKey } from "../src/lib/validation/validate";
import { SEED_NOW, seedFiles } from "./helpers";

const run = (files: Partial<Record<FileKey, string>>, now = SEED_NOW, skipAgeCheck = false) =>
  validateFiles(files, { now, skipAgeCheck }, rulesConfig);
const codes = (r: ReturnType<typeof run>) => r.errors.map((e) => e.code);
const wcodes = (r: ReturnType<typeof run>) => r.warnings.map((e) => e.code);

describe("D. data validation", () => {
  it("accepts the seed files with row counts and no errors", () => {
    const r = run(seedFiles());
    expect(r.errors).toEqual([]);
    expect(r.rowCounts).toEqual({ sku: 15, distributor: 4, sales: 240, inventory: 15, calendar: 24 });
    expect(r.parsed).not.toBeNull();
    expect(r.asOfDate).toBe("2026-10-19");
    expect(r.lastCompleteWeek).toBe("2026-W42");
  });

  it("parses CRLF and BOM files the same as LF", () => {
    const f = seedFiles();
    const crlf = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, "﻿" + v.replace(/\r?\n/g, "\r\n")]));
    const r = run(crlf as Record<FileKey, string>);
    expect(r.errors).toEqual([]);
    expect(r.rowCounts.sales).toBe(240);
  });

  it("blocks on a missing file", () => {
    const f = seedFiles();
    delete (f as Partial<typeof f>).calendar;
    const r = run(f);
    expect(codes(r)).toContain("MISSING_FILE");
    expect(r.parsed).toBeNull();
  });

  it("blocks on a missing column", () => {
    const f = seedFiles();
    f.sales = f.sales.replace("Units_Sold", "Units");
    expect(codes(run(f))).toContain("MISSING_COLUMN");
  });

  it("blocks on negative or non-whole units", () => {
    const f = seedFiles();
    f.sales = seedFiles().sales.replace(/SKU001,2026-W41,\d+/, "SKU001,2026-W41,-5");
    expect(codes(run(f))).toContain("BAD_UNITS");
    f.sales = seedFiles().sales.replace(/SKU001,2026-W41,\d+/, "SKU001,2026-W41,12.5");
    expect(codes(run(f))).toContain("BAD_UNITS");
    f.inventory = seedFiles().inventory.replace("SKU001,Pune Central Warehouse,900", "SKU001,Pune Central Warehouse,-1");
    expect(run(f).errors.some((e) => e.file === "inventory" && e.code === "BAD_UNITS")).toBe(true);
  });

  it("blocks on a duplicate (SKU, week)", () => {
    const f = seedFiles();
    f.sales += "SKU001,2026-W42,100\n";
    expect(codes(run(f))).toContain("DUPLICATE_WEEK");
  });

  it("blocks on an unknown SKU in sales or inventory", () => {
    const f = seedFiles();
    f.sales += "SKU999,2026-W42,100\n";
    f.inventory += "SKU998,Pune Central Warehouse,10,2026-10-19\n";
    const r = run(f);
    expect(r.errors.filter((e) => e.code === "UNKNOWN_SKU").map((e) => e.file).sort()).toEqual(["inventory", "sales"]);
  });

  it("blocks when a master SKU has no inventory row", () => {
    const f = seedFiles();
    f.inventory = f.inventory.replace(/SKU015,.*\n?/, "");
    expect(codes(run(f))).toContain("NO_INVENTORY");
  });

  it("blocks on a bad week format", () => {
    const f = seedFiles();
    f.sales = f.sales.replace("SKU001,2026-W41", "SKU001,2026-41");
    expect(codes(run(f))).toContain("BAD_WEEK");
  });

  it("blocks when an SKU has fewer than 12 weeks of sales", () => {
    const f = seedFiles();
    const short = f.sales
      .split("\n")
      .filter((l) => !(l.startsWith("SKU002,") && /W(2[7-9]|3[0-3])/.test(l)))
      .join("\n");
    const r = run({ ...f, sales: short });
    expect(codes(r)).toContain("SHORT_HISTORY");
  });

  it("blocks on a gap inside the last 12 weeks", () => {
    const f = seedFiles();
    f.sales = f.sales.replace(/SKU003,2026-W36,\d+\n/, "");
    // 15 weeks remain (still >= 12) but W36 is missing from the window.
    expect(codes(run(f))).toContain("WEEK_GAP");
  });

  it("blocks when sales do not end at the last complete week", () => {
    const f = seedFiles();
    f.sales = f.sales.split("\n").filter((l) => !l.includes("2026-W42")).join("\n");
    expect(codes(run(f))).toContain("SALES_NOT_CURRENT");
  });

  it("blocks stale inventory at upload and allows it for sample data with a warning", () => {
    const late = new Date("2026-11-03T06:00:00Z");
    expect(codes(run(seedFiles(), late))).toContain("STALE_INVENTORY");
    const sample = run(seedFiles(), late, true);
    expect(sample.errors).toEqual([]);
    expect(wcodes(sample)).toContain("AGE_CHECK_SKIPPED");
  });

  it("blocks when the as-of month is missing from the calendar", () => {
    const f = seedFiles();
    f.calendar = f.calendar.replace(/2026,10,2026-10,TRUE\r?\n/, "");
    expect(codes(run(f))).toContain("CALENDAR_MONTH_MISSING");
  });

  it("blocks on bad perishability and bad reorder quantity", () => {
    const f = seedFiles();
    f.sku = f.sku.replace("Beverage,Low,500", "Beverage,Medium,500").replace("Snack,Low,200", "Snack,Low,0");
    expect(codes(run(f))).toEqual(expect.arrayContaining(["BAD_PERISHABILITY", "BAD_REORDER_QTY"]));
  });

  it("warns on an inactive distributor", () => {
    const f = seedFiles();
    f.distributor = f.distributor.replace("DIST001,NutriFlow Distributors,Maharashtra,Active", "DIST001,NutriFlow Distributors,Maharashtra,Suspended");
    const r = run(f);
    expect(r.errors).toEqual([]);
    expect(wcodes(r)).toContain("DISTRIBUTOR_INACTIVE");
  });

  it("warns on a zero-sales week inside the last 12", () => {
    const f = seedFiles();
    f.sales = f.sales.replace(/SKU005,2026-W40,\d+/, "SKU005,2026-W40,0");
    const r = run(f);
    expect(r.errors).toEqual([]);
    expect(wcodes(r)).toContain("ZERO_WEEK");
  });

  it("warns on an SKU with no sales at all and does not block", () => {
    const f = seedFiles();
    f.sku += "SKU016,Freshroots New Launch,Snack,Low,100,Units,DIST001\n";
    f.inventory += "SKU016,Pune Central Warehouse,500,2026-10-19\n";
    const r = run(f);
    expect(r.errors).toEqual([]);
    expect(wcodes(r)).toContain("NO_SALES");
  });

  it("warns on stock far above any weekly sales figure", () => {
    // The seed's SKU006 holds 1100 units against a best week of about 45, which is over 15x.
    const r = run(seedFiles());
    expect(r.warnings.some((w) => w.code === "STOCK_VS_PEAK" && w.message.startsWith("SKU006"))).toBe(true);
  });

  it("an error writes nothing: no parsed data is returned", () => {
    const f = seedFiles();
    f.sales += "SKU001,2026-W42,100\n";
    expect(run(f).parsed).toBeNull();
  });
});

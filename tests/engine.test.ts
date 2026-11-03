import { describe, expect, it } from "vitest";
import { rulesConfig } from "../src/lib/config";
import { runRuleEngine } from "../src/lib/engine/rules";
import { lastCompleteWeek, parseDate, shiftWeek, weekToMonday, weekWindow } from "../src/lib/engine/weeks";
import { cfgWith, flagsFor, seedEngineInput, seedFiles, synthetic } from "./helpers";

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

describe("A. golden test on seed data", () => {
  const out = runRuleEngine(seedEngineInput(), rulesConfig);
  const by = Object.fromEntries(out.flags.map((f) => [f.skuId, f]));

  it("uses W42 as the last complete week and the festival uplift", () => {
    expect(out.lastCompleteWeek).toBe("2026-W42");
    expect(out.window12[0]).toBe("2026-W31");
    expect(out.window4[0]).toBe("2026-W39");
    expect(out.uplift).toBe(1.25);
  });

  it("flags exactly seven SKUs", () => {
    expect(out.flags.map((f) => f.skuId)).toEqual(["SKU001", "SKU003", "SKU004", "SKU006", "SKU007", "SKU011", "SKU013"]);
    expect(out.unflagged).toBe(8);
  });

  it.each([
    ["SKU001", ["HIGH_DEMAND", "STOCKOUT_RISK"], 3.35, "REORDER", 750],
    ["SKU003", ["STOCKOUT_RISK"], 4.36, "REORDER", 300],
    ["SKU004", ["STOCKOUT_RISK"], 1.8, "REORDER", 150],
    ["SKU006", ["OVERSTOCK_RISK"], 22.23, "PAUSE_ORDER", 0],
    ["SKU007", ["OVERSTOCK_RISK"], 4.08, "PAUSE_ORDER", 0],
    ["SKU011", ["STOCKOUT_RISK"], 1.8, "REORDER", 500],
    ["SKU013", ["STOCKOUT_RISK"], 3.17, "REORDER", 120],
  ])("%s", (id, types, cover, action, qty) => {
    expect(by[id].flagTypes).toEqual(types);
    expect(r2(by[id].coverWeeks)).toBe(cover);
    expect(by[id].ruleAction).toBe(action);
    expect(by[id].ruleQty).toBe(qty);
  });

  it("computes the SKU001 metrics from the worked example", () => {
    expect(r2(by.SKU001.avgWeeklySales)).toBe(214.92);
    expect(r2(by.SKU001.recentAvg)).toBe(261);
    expect(Math.round(by.SKU001.demandRatio * 10000) / 10000).toBe(1.2144);
  });

  it("uses the perishable band for SKU004 and SKU007", () => {
    expect([by.SKU004.minCover, by.SKU004.maxCover]).toEqual([3, 4]);
    expect([by.SKU007.minCover, by.SKU007.maxCover]).toEqual([3, 4]);
    expect([by.SKU001.minCover, by.SKU001.maxCover]).toEqual([6, 14]);
  });
});

describe("B. variant: festival uplift off", () => {
  const files = seedFiles();
  files.calendar = files.calendar.replace("2026,10,2026-10,TRUE", "2026,10,2026-10,FALSE");
  const out = runRuleEngine(seedEngineInput(files), rulesConfig);
  const by = Object.fromEntries(out.flags.map((f) => [f.skuId, f]));

  it("reads the uplift from the calendar", () => {
    expect(out.uplift).toBe(1);
    expect(out.flags.map((f) => f.skuId)).toEqual(["SKU001", "SKU002", "SKU003", "SKU004", "SKU006", "SKU007", "SKU011", "SKU013"]);
  });

  it.each([
    ["SKU001", 4.2],
    ["SKU002", 14.3],
    ["SKU003", 5.4],
    ["SKU004", 2.3],
    ["SKU006", 27.8],
    ["SKU007", 5.1],
    ["SKU011", 2.3],
    ["SKU013", 4.0],
  ])("%s cover is %s weeks", (id, cover) => {
    expect(Math.round(by[id].coverWeeks! * 10) / 10).toBe(cover);
  });

  it("flags SKU002 as overstock", () => {
    expect(by.SKU002.flagTypes).toEqual(["OVERSTOCK_RISK"]);
  });
});

describe("C. boundary tests", () => {
  // Flat sales of 100/week and no uplift: cover = onHand / 100.
  const flat = (onHand: number, perishability: "Low" | "High" = "Low") =>
    flagsFor(synthetic({ base: 100, recent: 100, onHand, perishability }))[0]?.flagTypes ?? [];

  it("demand ratio exactly 1.20 is not HIGH_DEMAND, 1.2001 is", () => {
    // base 3, recent 4 gives recent/avg = 4 / (40/12) = 1.2 exactly.
    // 30 units on hand at about 3.33/week is 9 weeks of cover, inside the 6-14 band.
    expect(flagsFor(synthetic({ base: 3, recent: 4, onHand: 30 }))).toHaveLength(0);
    // base 30000, recent 40002 gives a ratio just above 1.2 (about 1.20004); cover is 9 weeks.
    const f = flagsFor(synthetic({ base: 30000, recent: 40002, onHand: 300000 }));
    expect(f[0].flagTypes).toEqual(["HIGH_DEMAND"]);
  });

  it("normal SKU: cover 6.0 is fine, 5.99 is stockout", () => {
    expect(flat(600)).toEqual([]);
    expect(flat(599)).toEqual(["STOCKOUT_RISK"]);
  });

  it("normal SKU: cover 14.0 is fine, 14.01 is overstock", () => {
    expect(flat(1400)).toEqual([]);
    expect(flat(1401)).toEqual(["OVERSTOCK_RISK"]);
  });

  it("perishable SKU: 3.0 and 4.0 are fine, 2.99 and 4.01 flag", () => {
    expect(flat(300, "High")).toEqual([]);
    expect(flat(299, "High")).toEqual(["STOCKOUT_RISK"]);
    expect(flat(400, "High")).toEqual([]);
    expect(flat(401, "High")).toEqual(["OVERSTOCK_RISK"]);
  });

  it("perishable limits replace 6 and 14: cover 5.0 is overstock", () => {
    expect(flat(500, "High")).toEqual(["OVERSTOCK_RISK"]);
  });

  it("HIGH_DEMAND with OVERSTOCK_RISK is a pause that needs judgment", () => {
    const f = flagsFor(synthetic({ base: 100, recent: 160, onHand: 100000 }))[0];
    expect(f.flagTypes).toEqual(["HIGH_DEMAND", "OVERSTOCK_RISK"]);
    expect(f.ruleAction).toBe("PAUSE_ORDER");
    expect(f.ruleQty).toBe(0);
    expect(f.needsJudgment).toBe(true);
    expect(f.judgmentReasons.map((r) => r.code)).toContain("CONFLICTING_FLAGS");
  });

  it("quantities are whole numbers (1.5 x 150 = 225, 1.5 x 75 rounds half up to 113)", () => {
    const high = (qty: number) => flagsFor(synthetic({ base: 100, recent: 160, onHand: 100, qty }))[0];
    expect(high(150).ruleQty).toBe(225);
    expect(high(75).ruleQty).toBe(113);
  });

  it("stockout alone reorders 1.0 x standard quantity", () => {
    const f = flagsFor(synthetic({ base: 100, recent: 100, onHand: 100, qty: 150 }))[0];
    expect(f.ruleAction).toBe("REORDER");
    expect(f.ruleQty).toBe(150);
  });

  it("is deterministic: two runs give byte-identical output", () => {
    const input = seedEngineInput();
    expect(JSON.stringify(runRuleEngine(input, rulesConfig))).toBe(JSON.stringify(runRuleEngine(input, rulesConfig)));
  });

  it("changing a threshold in config changes the flags with no code change", () => {
    const input = synthetic({ base: 100, recent: 100, onHand: 599 });
    expect(flagsFor(input)[0].flagTypes).toEqual(["STOCKOUT_RISK"]);
    const loose = cfgWith((c) => {
      c.forecast.normalCover.min = 5;
    });
    expect(flagsFor(input, loose)).toHaveLength(0);
  });

  it("festival uplift of 25% lowers cover before the threshold check", () => {
    // 700 on hand at 100/week is 7 weeks (fine); with the uplift it is 5.6 weeks (stockout).
    expect(flagsFor(synthetic({ base: 100, recent: 100, onHand: 700 }))).toHaveLength(0);
    expect(flagsFor(synthetic({ base: 100, recent: 100, onHand: 700, festival: true }))[0].flagTypes).toEqual(["STOCKOUT_RISK"]);
  });
});

describe("needs judgment", () => {
  it("a zero-sales week inside the last 12 needs judgment", () => {
    const input = synthetic({ base: 100, recent: 100, onHand: 100 });
    input.sales[3].units = 0;
    expect(flagsFor(input)[0].judgmentReasons.map((r) => r.code)).toContain("ZERO_SALES_WEEK");
  });

  it("a week-on-week swing above 50% in the last four weeks needs judgment", () => {
    const input = synthetic({ base: 100, recent: 100, onHand: 100 });
    input.sales[10].units = 200;
    expect(flagsFor(input)[0].judgmentReasons.map((r) => r.code)).toContain("WEEKLY_SWING");
  });

  it("a plain flag does not need judgment", () => {
    expect(flagsFor(synthetic({ base: 100, recent: 100, onHand: 100 }))[0].needsJudgment).toBe(false);
  });
});

describe("scale", () => {
  it("400 SKUs with 52 weeks of history run in under 5 seconds", () => {
    const skus = [];
    const sales = [];
    const inventory = [];
    for (let i = 0; i < 400; i++) {
      const id = `S${String(i).padStart(4, "0")}`;
      skus.push({ skuId: id, name: id, category: "c", perishability: (i % 5 === 0 ? "High" : "Low") as "High" | "Low", standardQty: 100, uom: "Units", distributorId: "D" });
      inventory.push({ skuId: id, location: "W", unitsOnHand: (i * 37) % 3000, asOfDate: "2026-10-19" });
      for (let w = 0; w < 52; w++) sales.push({ skuId: id, week: shiftWeek("2026-W42", w - 51), units: 80 + ((i + w) % 40) });
    }
    const t = Date.now();
    const out = runRuleEngine({ asOfDate: "2026-10-19", skus, sales, inventory, isFestival: true }, rulesConfig);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(out.evaluated).toBe(400);
  });
});

describe("ISO weeks", () => {
  it("finds the last complete week", () => {
    expect(lastCompleteWeek(parseDate("2026-10-19")!)).toBe("2026-W42"); // Monday
    expect(lastCompleteWeek(parseDate("2026-10-25")!)).toBe("2026-W42"); // Sunday of W43
    expect(lastCompleteWeek(parseDate("2026-10-26")!)).toBe("2026-W43");
  });
  it("rolls over the year boundary", () => {
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
    expect(weekWindow("2026-W03", 4)).toEqual(["2025-W52", "2026-W01", "2026-W02", "2026-W03"]);
  });
  it("knows which years have a week 53", () => {
    expect(weekToMonday("2026-W53")).not.toBeNull();
    expect(weekToMonday("2025-W53")).toBeNull();
  });
});

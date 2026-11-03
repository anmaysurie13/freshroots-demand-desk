import { describe, expect, it } from "vitest";
import { rulesConfig } from "../src/lib/config";
import { csvCell, toCsv } from "../src/lib/csv";
import { evaluateKill1, evaluateKill2, quarterBounds, quarterToDateLoss } from "../src/lib/kill/logic";

describe("G. Kill 1 (min 30 reviewed, 10%, fallbacks excluded upstream)", () => {
  it.each([
    [29, 10, false, "below the minimum sample"],
    [30, 2, false, "6.7%"],
    [30, 3, true, "exactly 10%"],
    [100, 9, false, "9%"],
    [100, 10, true, "exactly 10%"],
    [0, 0, false, "nothing reviewed"],
  ])("%i reviewed, %i reversed => fire=%s (%s)", (reviewed, reversed, fire) => {
    expect(evaluateKill1(reviewed, reversed, rulesConfig).fire).toBe(fire);
  });

  it("reports collecting data before 30 reviews", () => {
    expect(evaluateKill1(12, 1, rulesConfig).collecting).toBe(true);
    expect(evaluateKill1(30, 1, rulesConfig).collecting).toBe(false);
  });

  it("reports the rate as a percentage", () => {
    expect(evaluateKill1(30, 3, rulesConfig).ratePct).toBeCloseTo(10);
  });
});

describe("G. Kill 2 (calendar quarter, strictly above)", () => {
  it.each([
    [2800000, "green"],
    [2800001, "alert"],
    [3400000, "alert"],
    [3400001, "killed"],
    [0, "green"],
  ])("Rs %i => %s", (loss, state) => {
    expect(evaluateKill2(loss, rulesConfig)).toBe(state);
  });
});

describe("quarters and sums", () => {
  it("finds calendar quarters", () => {
    expect(quarterBounds("2026-11-03")).toEqual({ label: "Q4 2026", start: "2026-10-01", end: "2026-12-31" });
    expect(quarterBounds("2027-01-01")).toEqual({ label: "Q1 2027", start: "2027-01-01", end: "2027-03-31" });
    expect(quarterBounds("2026-06-30").label).toBe("Q2 2026");
    expect(quarterBounds("2024-02-10").end).toBe("2024-03-31");
  });

  it("sums entries split over several records", () => {
    const q = quarterBounds("2026-11-03");
    const e = [
      { periodStart: "2026-10-01", stockout: 1000000, overstock: 400000 },
      { periodStart: "2026-10-15", stockout: 500000, overstock: 200000 },
      { periodStart: "2026-11-02", stockout: 800000, overstock: 0 },
    ];
    expect(quarterToDateLoss(e, q)).toBe(2900000);
  });

  it("does not count an entry from a different quarter", () => {
    const q = quarterBounds("2026-11-03");
    const e = [
      { periodStart: "2026-09-28", stockout: 9000000, overstock: 0 },
      { periodStart: "2027-01-05", stockout: 9000000, overstock: 0 },
      { periodStart: "2026-10-10", stockout: 100, overstock: 50 },
    ];
    expect(quarterToDateLoss(e, q)).toBe(150);
  });
});

describe("CSV export is formula-injection safe", () => {
  it.each([
    ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["plain", "plain"],
  ])("%s", (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it("quotes commas and quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });

  it("builds rows with CRLF endings", () => {
    expect(toCsv(["a", "b"], [["=x", 2]])).toBe("a,b\r\n'=x,2\r\n");
  });
});

import Papa from "papaparse";
import type { RulesConfig } from "../config";
import type { InventoryRow, Perishability, SalesRow, SkuMaster } from "../engine/types";
import { daysBetween, formatDate, isValidWeekLabel, lastCompleteWeek, parseDate, weekWindow } from "../engine/weeks";

export type FileKey = "sku" | "distributor" | "sales" | "inventory" | "calendar";
export const FILE_KEYS: FileKey[] = ["sales", "inventory", "sku", "distributor", "calendar"];

export const FILE_LABELS: Record<FileKey, string> = {
  sales: "weekly_sales.csv",
  inventory: "current_inventory.csv",
  sku: "sku_master.csv",
  distributor: "distributor_master.csv",
  calendar: "calendar.csv",
};

const REQUIRED_COLUMNS: Record<FileKey, string[]> = {
  sku: ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"],
  distributor: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
  sales: ["SKU_ID", "Week", "Units_Sold"],
  inventory: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
  calendar: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
};

export type Level = "ERROR" | "WARNING";

export interface Issue {
  level: Level;
  code: string;
  file: FileKey | "run";
  /** 1-based data row number (header excluded), when the issue belongs to a row. */
  row?: number;
  message: string;
}

export interface Distributor {
  distributorId: string;
  name: string;
  region: string;
  status: string;
}

export interface CalendarMonth {
  year: number;
  month: number;
  isFestival: boolean;
}

export interface ParsedData {
  asOfDate: string;
  isFestival: boolean;
  skus: SkuMaster[];
  distributors: Distributor[];
  sales: SalesRow[];
  inventory: InventoryRow[];
  calendar: CalendarMonth[];
}

export interface ValidationReport {
  errors: Issue[];
  warnings: Issue[];
  rowCounts: Partial<Record<FileKey, number>>;
  lastCompleteWeek: string | null;
  asOfDate: string | null;
  /** Present only when there are no errors. */
  parsed: ParsedData | null;
}

export interface ValidationContext {
  /** Moment of upload; the as-of age is measured against its calendar date in the configured timezone. */
  now: Date;
  /** Sample data skips the inventory-age check and says so as a warning. */
  skipAgeCheck?: boolean;
}

type Row = Record<string, string>;

function parseCsv(text: string): { columns: string[]; rows: Row[] } {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<Row>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return { columns: res.meta.fields ?? [], rows: res.data };
}

const WHOLE = /^\d+$/;

function todayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validateFiles(
  files: Partial<Record<FileKey, string>>,
  ctx: ValidationContext,
  cfg: RulesConfig,
): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: string, file: Issue["file"], message: string, row?: number) =>
    errors.push({ level: "ERROR", code, file, message, row });
  const warn = (code: string, file: Issue["file"], message: string, row?: number) =>
    warnings.push({ level: "WARNING", code, file, message, row });

  const rowCounts: ValidationReport["rowCounts"] = {};
  const tables: Partial<Record<FileKey, Row[]>> = {};

  for (const key of FILE_KEYS) {
    const text = files[key];
    if (text === undefined || text.trim() === "") {
      err("MISSING_FILE", key, `${FILE_LABELS[key]} is missing or empty.`);
      continue;
    }
    if (text.length > cfg.data.maxFileBytes) {
      err("FILE_TOO_LARGE", key, `${FILE_LABELS[key]} is larger than ${Math.round(cfg.data.maxFileBytes / 1024)} KB.`);
      continue;
    }
    const { columns, rows } = parseCsv(text);
    const missing = REQUIRED_COLUMNS[key].filter((c) => !columns.includes(c));
    if (missing.length) {
      err("MISSING_COLUMN", key, `${FILE_LABELS[key]} is missing column(s): ${missing.join(", ")}.`);
      continue;
    }
    if (rows.length > cfg.data.maxRowsPerFile) {
      err("TOO_MANY_ROWS", key, `${FILE_LABELS[key]} has more than ${cfg.data.maxRowsPerFile} rows.`);
      continue;
    }
    rowCounts[key] = rows.length;
    tables[key] = rows;
  }

  // ---- SKU master
  const skus: SkuMaster[] = [];
  const skuIds = new Set<string>();
  tables.sku?.forEach((r, i) => {
    const row = i + 1;
    const id = r.SKU_ID;
    if (!id) return err("EMPTY_SKU_ID", "sku", "SKU_ID is empty.", row);
    if (skuIds.has(id)) return err("DUPLICATE_SKU", "sku", `${id} appears more than once.`, row);
    skuIds.add(id);
    let ok = true;
    if (r.Perishability !== "Low" && r.Perishability !== "High") {
      err("BAD_PERISHABILITY", "sku", `${id}: Perishability must be Low or High (found "${r.Perishability}").`, row);
      ok = false;
    }
    const qty = Number(r.Standard_Reorder_Qty);
    if (!WHOLE.test(r.Standard_Reorder_Qty) || qty <= 0) {
      err("BAD_REORDER_QTY", "sku", `${id}: Standard_Reorder_Qty must be a positive whole number (found "${r.Standard_Reorder_Qty}").`, row);
      ok = false;
    }
    if (ok) {
      skus.push({
        skuId: id,
        name: r.SKU_Name,
        category: r.Category,
        perishability: r.Perishability as Perishability,
        standardQty: qty,
        uom: r.Unit_of_Measure,
        distributorId: r.Distributor_ID,
      });
    }
  });

  // ---- Distributors
  const distributors: Distributor[] = (tables.distributor ?? []).map((r) => ({
    distributorId: r.Distributor_ID,
    name: r.Distributor_Name,
    region: r.Region,
    status: r.Status,
  }));
  const distById = new Map(distributors.map((d) => [d.distributorId, d]));

  // ---- Calendar
  const calendar: CalendarMonth[] = [];
  tables.calendar?.forEach((r, i) => {
    const y = Number(r.Year);
    const m = Number(r.Month);
    const flag = r.Is_Festival_Month.toUpperCase();
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || (flag !== "TRUE" && flag !== "FALSE")) {
      err("BAD_CALENDAR_ROW", "calendar", "Calendar row needs a numeric Year, a Month of 1-12 and TRUE/FALSE for Is_Festival_Month.", i + 1);
      return;
    }
    calendar.push({ year: y, month: m, isFestival: flag === "TRUE" });
  });

  // ---- Inventory
  const inventory: InventoryRow[] = [];
  const invSeen = new Set<string>();
  const asOfDates = new Set<string>();
  tables.inventory?.forEach((r, i) => {
    const row = i + 1;
    const id = r.SKU_ID;
    if (skuIds.size && !skuIds.has(id)) err("UNKNOWN_SKU", "inventory", `${id} is not in sku_master.csv.`, row);
    if (!WHOLE.test(r.Units_On_Hand)) {
      err("BAD_UNITS", "inventory", `${id}: Units_On_Hand must be a whole number of 0 or more (found "${r.Units_On_Hand}").`, row);
      return;
    }
    if (!parseDate(r.As_Of_Date)) {
      err("BAD_DATE", "inventory", `${id}: As_Of_Date must be YYYY-MM-DD (found "${r.As_Of_Date}").`, row);
      return;
    }
    if (invSeen.has(id)) {
      err("DUPLICATE_INVENTORY", "inventory", `${id} has more than one inventory row. One row per SKU is supported.`, row);
      return;
    }
    invSeen.add(id);
    asOfDates.add(r.As_Of_Date);
    inventory.push({ skuId: id, location: r.Location, unitsOnHand: Number(r.Units_On_Hand), asOfDate: r.As_Of_Date });
  });
  for (const s of skus) {
    if (tables.inventory && !invSeen.has(s.skuId)) err("NO_INVENTORY", "inventory", `${s.skuId} (${s.name}) has no inventory row.`);
  }

  let asOfDate: string | null = null;
  if (asOfDates.size > 1) {
    err("MIXED_AS_OF", "inventory", `Inventory rows carry different As_Of_Date values (${[...asOfDates].sort().join(", ")}).`);
  } else if (asOfDates.size === 1) {
    asOfDate = [...asOfDates][0];
  }

  // ---- Sales
  const sales: SalesRow[] = [];
  const salesSeen = new Set<string>();
  const weeksBySku = new Map<string, Set<string>>();
  tables.sales?.forEach((r, i) => {
    const row = i + 1;
    const id = r.SKU_ID;
    let ok = true;
    if (skuIds.size && !skuIds.has(id)) {
      err("UNKNOWN_SKU", "sales", `${id} is not in sku_master.csv.`, row);
      ok = false;
    }
    if (!isValidWeekLabel(r.Week)) {
      err("BAD_WEEK", "sales", `${id}: Week must look like 2026-W42 (found "${r.Week}").`, row);
      ok = false;
    }
    if (!WHOLE.test(r.Units_Sold)) {
      err("BAD_UNITS", "sales", `${id} ${r.Week}: Units_Sold must be a whole number of 0 or more (found "${r.Units_Sold}").`, row);
      ok = false;
    }
    if (!ok) return;
    const k = `${id}|${r.Week}`;
    if (salesSeen.has(k)) {
      err("DUPLICATE_WEEK", "sales", `${id} ${r.Week} appears more than once.`, row);
      return;
    }
    salesSeen.add(k);
    let set = weeksBySku.get(id);
    if (!set) weeksBySku.set(id, (set = new Set()));
    set.add(r.Week);
    sales.push({ skuId: id, week: r.Week, units: Number(r.Units_Sold) });
  });

  // ---- Checks that need the as-of date
  const asOf = asOfDate ? parseDate(asOfDate) : null;
  let lastWeek: string | null = null;
  if (asOf) {
    lastWeek = lastCompleteWeek(asOf);

    if (!calendar.some((c) => c.year === asOf.getUTCFullYear() && c.month === asOf.getUTCMonth() + 1) && tables.calendar) {
      err("CALENDAR_MONTH_MISSING", "calendar", `calendar.csv has no row for ${asOfDate!.slice(0, 7)}, so the festival uplift cannot be decided.`);
    }

    const today = todayIn(cfg.timezone, ctx.now);
    const age = daysBetween(asOf, parseDate(today)!);
    if (age < 0) {
      err("FUTURE_AS_OF", "inventory", `As_Of_Date ${asOfDate} is in the future.`);
    } else if (age > cfg.data.maxInventoryAgeDays) {
      if (ctx.skipAgeCheck) {
        warn("AGE_CHECK_SKIPPED", "inventory", `Inventory is ${age} days old (limit ${cfg.data.maxInventoryAgeDays}). The age check is skipped because this is sample data.`);
      } else {
        err("STALE_INVENTORY", "inventory", `Inventory is ${age} days old at upload. The limit is ${cfg.data.maxInventoryAgeDays} days. Pull fresh data from SAP.`);
      }
    }

    if (sales.length) {
      const newest = sales.reduce((m, s) => (s.week > m ? s.week : m), "");
      if (newest !== lastWeek) {
        err("SALES_NOT_CURRENT", "sales", `Sales end at ${newest}, but the last complete week before ${asOfDate} is ${lastWeek}.`);
      }
    }

    const window12 = weekWindow(lastWeek, cfg.forecast.averageWeeks);
    for (const s of skus) {
      const weeks = weeksBySku.get(s.skuId);
      if (!weeks || weeks.size === 0) {
        if (tables.sales) warn("NO_SALES", "sales", `${s.skuId} (${s.name}) has no sales rows. New launch? It will not be evaluated.`);
        continue;
      }
      if (weeks.size < cfg.forecast.minWeeksHistory) {
        err("SHORT_HISTORY", "sales", `${s.skuId} has only ${weeks.size} weeks of sales; at least ${cfg.forecast.minWeeksHistory} are required.`);
        continue;
      }
      const gaps = window12.filter((w) => !weeks.has(w));
      if (gaps.length) {
        err("WEEK_GAP", "sales", `${s.skuId} has no sales row for ${gaps.join(", ")} inside the last ${cfg.forecast.averageWeeks} weeks.`);
        continue;
      }
      const zero = sales.filter((x) => x.skuId === s.skuId && window12.includes(x.week) && x.units === 0);
      if (zero.length) {
        warn("ZERO_WEEK", "sales", `${s.skuId} sold 0 units in ${zero.map((z) => z.week).join(", ")}.`);
      }
    }
  }

  // ---- Warnings that do not need the as-of date
  for (const s of skus) {
    const d = distById.get(s.distributorId);
    if (tables.distributor && !d) {
      warn("UNKNOWN_DISTRIBUTOR", "sku", `${s.skuId} points to ${s.distributorId}, which is not in distributor_master.csv.`);
    } else if (d && d.status.toLowerCase() !== "active") {
      warn("DISTRIBUTOR_INACTIVE", "sku", `${s.skuId} sits under ${d.name}, whose status is "${d.status}".`);
    }
  }
  const peak = new Map<string, number>();
  for (const s of sales) peak.set(s.skuId, Math.max(peak.get(s.skuId) ?? 0, s.units));
  for (const inv of inventory) {
    const p = peak.get(inv.skuId);
    if (p && inv.unitsOnHand > p * cfg.data.stockVsPeakWarnMultiple) {
      warn("STOCK_VS_PEAK", "inventory", `${inv.skuId}: ${inv.unitsOnHand} units on hand is more than ${cfg.data.stockVsPeakWarnMultiple}x its best weekly sales (${p}). Possible unit mismatch.`);
    }
  }

  const isFestival = asOf
    ? calendar.find((c) => c.year === asOf.getUTCFullYear() && c.month === asOf.getUTCMonth() + 1)?.isFestival ?? false
    : false;

  const blocked = errors.length > 0;
  return {
    errors,
    warnings,
    rowCounts,
    lastCompleteWeek: lastWeek,
    asOfDate,
    parsed: blocked || !asOfDate ? null : { asOfDate, isFestival, skus, distributors, sales, inventory, calendar },
  };
}

export { formatDate };

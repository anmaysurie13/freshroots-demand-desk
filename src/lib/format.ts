const TZ = "Asia/Kolkata";

/** Indian digit grouping: 2800000 -> "28,00,000". */
export function rupees(n: number): string {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

export function lakh(n: number): string {
  return `Rs ${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} lakh`;
}

export function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
}

export function weeks(n: number | null): string {
  return n === null ? "no demand" : `${n.toFixed(2)} wk`;
}

export function pct(n: number | null, digits = 1): string {
  return n === null ? "n/a" : `${n.toFixed(digits)}%`;
}

export function hours(n: number | null): string {
  if (n === null) return "n/a";
  return n < 48 ? `${n.toFixed(1)} h` : `${(n / 24).toFixed(1)} d`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

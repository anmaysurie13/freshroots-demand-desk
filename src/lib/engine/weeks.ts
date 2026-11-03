// ISO-8601 week helpers. All dates are handled as UTC midnight to avoid timezone drift.

const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

export function parseDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Monday of the ISO week that contains `d`. */
function mondayOf(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(d, -dow);
}

/** ISO year and week number for a date. */
export function isoWeekOf(d: Date): { year: number; week: number } {
  const thursday = addDays(mondayOf(d), 3);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor(daysBetween(jan1, thursday) / 7) + 1;
  return { year, week };
}

export function formatWeek(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function isValidWeekLabel(label: string): boolean {
  const m = WEEK_RE.exec(label);
  if (!m) return false;
  const week = +m[2];
  return week >= 1 && week <= 53 && weekToMonday(label) !== null;
}

/** Monday date of a `YYYY-Www` label, or null when the label does not exist (e.g. W53 in a 52-week year). */
export function weekToMonday(label: string): Date | null {
  const m = WEEK_RE.exec(label);
  if (!m) return null;
  const year = +m[1];
  const week = +m[2];
  if (week < 1 || week > 53) return null;
  // Jan 4th is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = addDays(mondayOf(jan4), (week - 1) * 7);
  const back = isoWeekOf(monday);
  if (back.year !== year || back.week !== week) return null;
  return monday;
}

export function shiftWeek(label: string, delta: number): string {
  const monday = weekToMonday(label);
  if (!monday) throw new Error(`Invalid week label: ${label}`);
  const { year, week } = isoWeekOf(addDays(monday, delta * 7));
  return formatWeek(year, week);
}

/** The ISO week that has fully ended before `asOf` (the week before the one containing `asOf`). */
export function lastCompleteWeek(asOf: Date): string {
  const { year, week } = isoWeekOf(addDays(mondayOf(asOf), -7));
  return formatWeek(year, week);
}

/** `count` consecutive week labels ending at `last`, oldest first. */
export function weekWindow(last: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftWeek(last, -i));
  return out;
}

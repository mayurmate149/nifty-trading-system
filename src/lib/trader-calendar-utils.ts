/** Shared date helpers for trader calendar (client + server safe). */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getIstMonthBounds(year: number, month1to12: number): { from: string; to: string } {
  const from = `${year}-${pad2(month1to12)}-01`;
  const lastDay = new Date(year, month1to12, 0).getDate();
  const to = `${year}-${pad2(month1to12)}-${pad2(lastDay)}`;
  return { from, to };
}

export function parseIstMonthFromYyyymm(yyyymm: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Today's calendar date (YYYY-MM-DD) in Asia/Kolkata. */
export function getIstTodayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Weekday 0 = Sunday … 6 = Saturday for this civil date in Asia/Kolkata. */
export function istCivilWeekdaySun0(year: number, month1to12: number, day: number): number {
  const iso = `${year}-${pad2(month1to12)}-${pad2(day)}`;
  const d = new Date(`${iso}T12:00:00+05:30`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sunday";
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return map[wd] ?? 0;
}

/**
 * Flat list of week cells for a month grid (Sunday-first columns), padded with nulls.
 * Each entry is an IST civil date or padding outside the month.
 */
export function getIstMonthGridCells(
  year: number,
  month1to12: number,
): ({ iso: string; dayOfMonth: number } | null)[] {
  const lastDay = new Date(year, month1to12, 0).getDate();
  const lead = istCivilWeekdaySun0(year, month1to12, 1);
  const cells: ({ iso: string; dayOfMonth: number } | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push({
      iso: `${year}-${pad2(month1to12)}-${pad2(day)}`,
      dayOfMonth: day,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

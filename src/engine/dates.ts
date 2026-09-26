/**
 * Calendar arithmetic for fees and interest.
 *
 * Every date is a YYYY-MM-DD string and every calculation is done in UTC, so
 * a fee or an interest charge is the same figure on any machine in any
 * timezone. Ranges are inclusive: [2026-07-01, 2026-09-30] is the whole of Q3,
 * 92 days.
 */

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The calendar day after `date`. */
export function dayAfter(date: string): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

/** The calendar day before `date`. */
export function dayBefore(date: string): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

/** Whole days from `a` to `b`: 0 for the same day, negative if `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
}

/** Days in an inclusive range. */
export function daysIn(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/**
 * Days from `a` to `b` on a 30/360 basis (the US convention): every month has
 * 30 days, so a quarter is always 90.
 */
export function days360(a: string, b: string): number {
  const [y1, m1, d1raw] = a.split('-').map(Number);
  const [y2, m2, d2raw] = b.split('-').map(Number);
  const d1 = Math.min(d1raw, 30);
  const d2 = d1 === 30 ? Math.min(d2raw, 30) : d2raw;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

/**
 * How many months a fee period lasts, from the fraction of a year a call
 * charges: 0.25 is a quarter. Anything that is not a whole number of months
 * falls back to a quarter, the common case, rather than inventing a period.
 */
export function periodMonths(periodFraction: number | null): number {
  const months = Math.round(12 * (periodFraction ?? 0.25));
  return [1, 2, 3, 4, 6, 12].includes(months) ? months : 3;
}

/**
 * The fee period containing `date`, aligned to the calendar: with quarters,
 * 2026-08-15 is in [2026-07-01, 2026-09-30].
 */
export function periodContaining(date: string, months: number): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const startMonth = Math.floor((m - 1) / months) * months; // 0-based
  const from = new Date(Date.UTC(y, startMonth, 1));
  const next = new Date(Date.UTC(y, startMonth + months, 1));
  return { from: iso(from), to: dayBefore(iso(next)) };
}

/** Split an inclusive range at calendar fee periods. */
export function splitByPeriod(from: string, to: string, months: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let at = from;
  while (at <= to) {
    const p = periodContaining(at, months);
    const end = p.to < to ? p.to : to;
    out.push({ from: at, to: end });
    at = dayAfter(end);
  }
  return out;
}

/** "Q3 2026", "H2 2026", "2026", or the range itself for other lengths. */
export function periodLabel(from: string, months: number): string {
  const [y, m] = from.split('-').map(Number);
  if (months === 3) return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  if (months === 6) return `H${m <= 6 ? 1 : 2} ${y}`;
  if (months === 12) return String(y);
  return from;
}

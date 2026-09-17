/**
 * Number, date and text primitives shared by the whole engine.
 *
 * These are deliberately tiny and dependency-free. `num` and `round` in
 * particular are load-bearing for cent-exactness — the golden fixture matches
 * the accountant's workbook to the cent because of the exact epsilon in
 * `round`. Change them only with the engine test suite in front of you.
 */

import type { Cell } from './types';

/**
 * Coerce a spreadsheet cell to a number, tolerating the formatting Excel and
 * humans introduce: `"1,500,000"`, `" 2% "`, `"$500"` all parse. Blanks,
 * nulls and unparseable text become 0 rather than NaN, so one bad cell cannot
 * poison a whole allocation with NaN.
 */
export function num(v: Cell): number {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[,\s%$]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Round half-up to `d` decimal places, symmetrically around zero.
 *
 * The `1e-9` nudge is not cosmetic. Binary floating point stores values like
 * 1.005 fractionally below the true decimal, so a plain `Math.round` would
 * round it down and throw allocations off by a cent. Rounding the magnitude and
 * re-applying the sign keeps negative amounts (fee offsets) symmetric with
 * positive ones.
 */
export function round(x: number, d: number): number {
  const f = Math.pow(10, d);
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}

/** Excel-style boolean: `"Y"` in any case, with surrounding space, is true. */
export function yes(v: Cell): boolean {
  return String(v || '').trim().toUpperCase() === 'Y';
}

/**
 * Split a comma- or semicolon-separated ID list (`"LP01, LP03"`) into IDs,
 * dropping blanks. Used for excused LPs and fee-exempt LPs.
 */
export function ids(s: Cell): string[] {
  return String(s || '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Normalise a date to `YYYY-MM-DD`.
 *
 * Excel stores dates as a serial day count from 1899-12-30; 25569 is the offset
 * to the Unix epoch. Strings are parsed as dates, and anything unparseable is
 * passed through unchanged so bad input stays visible rather than becoming
 * "Invalid Date".
 */
export function serialToISO(v: Cell): string {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

/**
 * Render an ISO date for display: `2026-09-30` -> `30 September 2026`.
 * Forced to UTC so the displayed date never shifts with the viewer's timezone —
 * a notice must not say a payment is due a day earlier in one office.
 */
export function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Money for display, with thousands separators and fixed decimals.
 * Negatives use accounting parentheses — `(10,526.32)` — as they appear on the
 * notice for fee offsets. Returns `''` for blanks so empty cells stay empty.
 */
export function fmt(n: number | null | undefined | '', d = 2): string {
  if (n == null || n === '') return '';
  const s = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return n < 0 ? `(${s})` : s;
}

/** Render a rate fraction as a percentage: `0.02` -> `2.00%`. */
export function pct(r: Cell): string {
  return (
    (num(r) * 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + '%'
  );
}

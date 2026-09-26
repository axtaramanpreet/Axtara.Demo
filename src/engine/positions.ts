/**
 * Where each investor stands on a date, from what the fund has done.
 *
 * A call used to start from balances typed in, or carried forward from the
 * previous call — a copy of the numbers that could drift. This adds them up
 * instead, from the record: each issued call as it was sent, and each
 * finalised equalization.
 *
 *   paid in    = opening + Σ called               + Σ equalization capital and catch-up fee
 *   drawn      = opening + Σ called against commitment + Σ equalization against commitment
 *   unfunded   = commitment now − drawn
 *   invested   = opening + Σ called for deals      + Σ equalization's share of deals
 *
 * Unfunded is worked out from what has been drawn, not carried as a balance,
 * so one rule covers an investor from the first close, one who joined late,
 * and one who increased their commitment: whatever they have committed now,
 * less what has been drawn against it.
 *
 * "Opening" is the earliest issued call's own opening balances: history from
 * before the fund was on Axtara. Interest on a late close is not capital, so it
 * moves none of these.
 */

import { isDeal } from './categories';
import { round } from './format';
import type { DatedAmount } from './fee-run';
import type { EqualizationLine } from './equalization';
import type { ComputedRow, EqualizationDueEntry, FeeScheduleEntry } from './types';

/** One investor in an issued call, as its frozen snapshot recorded them. */
export interface IssuedCallLine {
  lpId: string;
  name: string;
  commitment: number;
  openPaid: number;
  openUnfunded: number;
  openInvested: number;
  /** Everything called, management fee included. */
  total: number;
  /** The part of `total` that counted against commitment. */
  reduces: number;
  /** Capital called, management fee excluded. */
  capital: number;
  /** The part of `capital` that counted against commitment. */
  inside: number;
  /** Called for deals: what becomes invested capital. */
  deal: number;
}

export interface IssuedCall {
  callNo: number;
  callDate: string;
  dueDate: string;
  lines: IssuedCallLine[];
  /** The fee periods it billed, frozen when it was sent. Absent for a call that charged rate × share of a year. */
  feeSchedule?: FeeScheduleEntry[] | null;
  /** Later closings' equalization it settled, frozen when it was sent. Absent: none. */
  equalizationSchedule?: EqualizationDueEntry[] | null;
}

/** An issued call, from the rows its snapshot froze. */
export function issuedCallFrom(
  callNo: number,
  callDate: string,
  dueDate: string,
  rows: ComputedRow[],
  schedules: { fee?: FeeScheduleEntry[] | null; equalization?: EqualizationDueEntry[] | null } = {},
): IssuedCall {
  return {
    callNo,
    callDate,
    dueDate,
    feeSchedule: schedules.fee ?? null,
    equalizationSchedule: schedules.equalization ?? null,
    lines: rows
      .filter((r) => r.isActive)
      .map((r) => {
        const capital = r.comps.reduce((s, c) => s + c.amt, 0);
        return {
          lpId: r.LP_ID,
          name: String(r.LP_Name ?? r.LP_ID),
          commitment: Number(r.Commitment) || 0,
          openPaid: r.openPaid,
          openUnfunded: r.openUCC,
          openInvested: Number(r.Opening_Invested_Capital) || 0,
          total: r.total,
          reduces: r.reduces,
          capital,
          inside: r.comps.filter((c) => c.reduces).reduce((s, c) => s + c.amt, 0),
          deal: r.comps.filter((c) => isDeal(c.category)).reduce((s, c) => s + c.amt, 0),
        };
      }),
  };
}

export interface FinalisedEqualization {
  closingDate: string;
  lines: EqualizationLine[];
  /** Whether the catch-up fee counts against commitment, as the fund's fee does. */
  feeReducesUnfunded: boolean;
}

export interface Position {
  lpId: string;
  name: string;
  commitment: number;
  paidIn: number;
  unfunded: number;
  invested: number;
}

/**
 * Every investor's position on `date`.
 *
 * `commitments`, when given, is the fund's closings: each investor's dated
 * commitments. Without it (a fund whose register came from a workbook), the
 * latest call's commitments stand.
 */
export function positionsAsOf(
  date: string,
  input: {
    calls: IssuedCall[];
    equalizations?: FinalisedEqualization[];
    commitments?: Record<string, { name: string; changes: DatedAmount[] }>;
    decimals?: number;
  },
): Position[] {
  const d = input.decimals ?? 2;
  const calls = input.calls.filter((c) => c.callDate <= date).sort((a, b) => a.callDate.localeCompare(b.callDate) || a.callNo - b.callNo);
  const eqs = (input.equalizations ?? []).filter((e) => e.closingDate <= date);
  const out = new Map<string, Position & { drawn: number }>();
  const at = (lpId: string, name: string) => {
    let p = out.get(lpId);
    if (!p) {
      p = { lpId, name, commitment: 0, paidIn: 0, unfunded: 0, invested: 0, drawn: 0 };
      out.set(lpId, p);
    }
    return p;
  };

  // History from before Axtara: the first issued call's own opening balances.
  for (const l of calls[0]?.lines ?? []) {
    const p = at(l.lpId, l.name);
    p.paidIn += l.openPaid;
    p.drawn += l.commitment - l.openUnfunded;
    p.invested += l.openInvested;
  }

  const dealShare = new Map<number, number>();
  for (const c of calls) {
    const called = c.lines.reduce((s, l) => s + l.capital, 0);
    dealShare.set(c.callNo, called > 0 ? c.lines.reduce((s, l) => s + l.deal, 0) / called : 0);
    for (const l of c.lines) {
      const p = at(l.lpId, l.name);
      p.paidIn += l.total;
      p.drawn += l.reduces;
      p.invested += l.deal;
    }
  }

  for (const e of eqs) {
    for (const l of e.lines) {
      const p = at(l.lpId, l.name);
      p.paidIn += l.capital + l.catchUpFee;
      p.drawn += l.inside + (e.feeReducesUnfunded ? l.catchUpFee : 0);
      p.invested += l.calls.reduce((s, c) => s + c.capital * (dealShare.get(c.callNo) ?? 0), 0);
    }
  }

  // Commitment: the fund's closings where it has them, else the latest call's.
  if (input.commitments) {
    for (const [lpId, { name, changes }] of Object.entries(input.commitments)) {
      const amount = changes.filter((c) => c.from <= date).reduce((s, c) => s + c.amount, 0);
      if (amount === 0 && !out.has(lpId)) continue;
      at(lpId, name).commitment = amount;
    }
  } else {
    const last = calls[calls.length - 1];
    for (const l of last?.lines ?? []) at(l.lpId, l.name).commitment = l.commitment;
  }

  return [...out.values()]
    .map(({ drawn, ...p }) => ({
      ...p,
      paidIn: round(p.paidIn, d),
      unfunded: round(p.commitment - drawn, d),
      invested: round(p.invested, d),
    }))
    .sort((a, b) => a.lpId.localeCompare(b.lpId));
}

/**
 * The management fee, as its own calculation.
 *
 * A call can charge a fee inside it (compute.ts), but a fund's fee is really a
 * schedule: a rate, on a basis, over periods, for whoever was an investor on
 * each day. This works that out for any range of dates, from the fund's dated
 * terms and each investor's dated commitments, and keeps every piece of the
 * working so it can be shown line by line.
 *
 * A range is cut into slices wherever something that changes the fee changes:
 * the terms (a step-down after the investment period), an investor's
 * commitment (a late close), or their invested capital. Within a slice nothing
 * moves, so the fee for it is one multiplication.
 *
 *   fee(slice) = basis × rate × fraction
 *
 * where the fraction follows the fund's day count. The investor's fee is the
 * sum of their slices, rounded once, at the end.
 */

import { dayAfter, dayBefore, days360, daysIn, periodContaining, periodMonths, splitByPeriod } from './dates';
import { fmtDate, round } from './format';
import { termsOn, type FundTerms } from './fund-terms';

/** A change to an investor's commitment, from a date. Cumulative. */
export interface DatedAmount {
  from: string;
  amount: number;
}

export interface FeeInvestor {
  lpId: string;
  name: string;
  /** Changes to commitment. The commitment on a date is the sum up to it. */
  commitments: DatedAmount[];
  /** Changes to invested capital, for a fee on invested capital. */
  invested?: DatedAmount[];
  /** A side-letter rate, instead of the fund's. */
  feeRateOverride?: number | null;
  /** Pays no management fee at all. */
  feeExempt?: boolean;
}

export interface FeeSlice {
  from: string;
  to: string;
  days: number;
  basisKind: string;
  basis: number;
  rate: number;
  /** The share of a year's fee this slice carries. */
  fraction: number;
  /** How the fraction was reached, e.g. "0.25 × 31/92" or "92/365". */
  fractionWorking: string;
  /** Unrounded; the investor's total is rounded once. */
  amount: number;
}

export interface FeeLine {
  lpId: string;
  name: string;
  exempt: boolean;
  slices: FeeSlice[];
  fee: number;
}

export interface FeeResult {
  from: string;
  to: string;
  lines: FeeLine[];
  total: number;
  /** Things worth saying about how the fee was reached. */
  notes: { level: 'info' | 'warn'; text: string }[];
}

const amountOn = (changes: DatedAmount[] | undefined, date: string) =>
  (changes ?? []).filter((c) => c.from <= date).reduce((s, c) => s + c.amount, 0);

/** The fraction of a year's fee one slice carries, and how it was reached. */
function fractionOf(slice: { from: string; to: string }, terms: FundTerms | null, periodDays: number) {
  const days = daysIn(slice.from, slice.to);
  switch (terms?.feeDayCount) {
    case 'actual_365':
      return { fraction: days / 365, working: `${days}/365` };
    case 'actual_360':
      return { fraction: days / 360, working: `${days}/360` };
    case '30_360': {
      const d = days360(slice.from, dayAfter(slice.to));
      return { fraction: d / 360, working: `${d}/360 (30/360)` };
    }
    default: {
      // Period fraction: the fraction set for a whole period, pro-rated by the
      // days of it this slice covers. A full quarter at 0.25 is exactly 0.25.
      const pf = terms?.feePeriodFraction ?? 0.25;
      return days === periodDays
        ? { fraction: pf, working: `${pf}` }
        : { fraction: (pf * days) / periodDays, working: `${pf} × ${days}/${periodDays}` };
    }
  }
}

/**
 * The fee for every investor over an inclusive range of dates.
 *
 * `decimals` is the rounding for each investor's total; terms in force on each
 * slice's first day decide its basis, rate and day count.
 */
export function feeForRange(
  from: string,
  to: string,
  history: FundTerms[],
  investors: FeeInvestor[],
  decimals = 2,
): FeeResult {
  const notes: FeeResult['notes'] = [];
  const months = periodMonths(termsOn(history, from)?.feePeriodFraction ?? null);

  // Every date inside the range where something that moves the fee changes.
  const cuts = new Set<string>();
  for (const t of history) if (t.effectiveFrom > from && t.effectiveFrom <= to) cuts.add(t.effectiveFrom);
  for (const inv of investors) {
    for (const c of [...inv.commitments, ...(inv.invested ?? [])]) {
      if (c.from > from && c.from <= to) cuts.add(c.from);
    }
  }

  // Fee periods first (a part-period is pro-rated against its own period's
  // length), then the cuts inside each.
  const slices: { from: string; to: string; periodDays: number }[] = [];
  for (const period of splitByPeriod(from, to, months)) {
    // The whole calendar period this piece belongs to, even when the range
    // starts or ends inside it: a part-period is a share of the full one.
    const whole = periodContaining(period.from, months);
    const periodDays = daysIn(whole.from, whole.to);
    let at = period.from;
    const inside = [...cuts].filter((c) => c > period.from && c <= period.to).sort();
    for (const cut of inside) {
      slices.push({ from: at, to: dayBefore(cut), periodDays });
      at = cut;
    }
    slices.push({ from: at, to: period.to, periodDays });
  }

  if (!termsOn(history, from)) {
    notes.push({ level: 'warn', text: `No fund terms are in force on ${from}; the fee is nil until they are recorded.` });
  }

  const lines: FeeLine[] = investors.map((inv) => {
    const exempt = Boolean(inv.feeExempt);
    const out: FeeSlice[] = [];
    for (const s of slices) {
      const terms = termsOn(history, s.from);
      const kindRaw = terms?.feeBasis ?? 'Commitment';
      // The register carries no NAV, so a NAV basis falls back to commitment —
      // said once, below, rather than silently.
      const kind = kindRaw === 'Invested_Capital' ? 'Invested_Capital' : 'Commitment';
      const basis = kind === 'Invested_Capital' ? amountOn(inv.invested, s.from) : amountOn(inv.commitments, s.from);
      const exemptByTerms = (terms?.feeExemptLpIds ?? []).includes(inv.lpId);
      // As in the call engine: a zero or blank side-letter rate means "no
      // override", not "no fee". Only an exemption means no fee.
      const override = inv.feeRateOverride && inv.feeRateOverride > 0 ? inv.feeRateOverride : null;
      const rate = exempt || exemptByTerms ? 0 : (override ?? terms?.feeRateAnnual ?? 0);
      const { fraction, working } = fractionOf(s, terms, s.periodDays);
      out.push({
        from: s.from,
        to: s.to,
        days: daysIn(s.from, s.to),
        basisKind: kind,
        basis,
        rate,
        fraction,
        fractionWorking: working,
        amount: basis * rate * fraction,
      });
    }
    return {
      lpId: inv.lpId,
      name: inv.name,
      exempt: exempt || (termsOn(history, from)?.feeExemptLpIds ?? []).includes(inv.lpId),
      slices: out,
      fee: round(out.reduce((s, x) => s + x.amount, 0), decimals),
    };
  });

  if (slices.some((sl) => termsOn(history, sl.from)?.feeBasis === 'NAV')) {
    notes.push({ level: 'warn', text: 'The fee basis is NAV, which the register does not carry; commitment was used instead.' });
  }
  const cutList = [...cuts].sort();
  if (cutList.length) {
    notes.push({
      level: 'info',
      text: `The period is split on ${cutList.map(fmtDate).join(', ')}, where the terms or an investor's position change.`,
    });
  }

  return { from, to, lines, total: round(lines.reduce((s, l) => s + l.fee, 0), decimals), notes };
}

/** One investor's true-up: what they should have paid against what they were charged. */
export interface TrueUpLine {
  lpId: string;
  name: string;
  charged: number;
  shouldHave: number;
  trueUp: number;
}

/**
 * Compare a fresh calculation with what was charged for the same period.
 *
 * Both halves are kept, not just the difference: "charged 47,500, should have
 * been 49,218.75" is an audit trail, and a bare 1,718.75 is a claim.
 */
export function trueUp(
  charged: { lpId: string; name: string; fee: number }[],
  now: FeeResult,
  decimals = 2,
): TrueUpLine[] {
  const ids = new Set([...charged.map((c) => c.lpId), ...now.lines.map((l) => l.lpId)]);
  return [...ids].map((lpId) => {
    const was = charged.find((c) => c.lpId === lpId);
    const is = now.lines.find((l) => l.lpId === lpId);
    const c = was?.fee ?? 0;
    const s = is?.fee ?? 0;
    return { lpId, name: is?.name ?? was?.name ?? lpId, charged: c, shouldHave: s, trueUp: round(s - c, decimals) };
  });
}

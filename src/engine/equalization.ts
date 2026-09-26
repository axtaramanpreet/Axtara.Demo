/**
 * Equalization at a later close.
 *
 * Investors admitted at a later close must end up as if they had been in from
 * the start: they pay their share of every call made before they joined, and
 * the investors who paid those calls get that money back. On top of the
 * capital, late investors pay interest for having paid late, and the
 * management fee they would have paid since the first close.
 *
 * Capital only is equalized. The missed management fee is charged separately,
 * as the catch-up fee, and the interest and fee go wherever this fund's terms
 * say (`equalizationInterestTo`, `catchUpFeeTo`), so each piece is its own
 * traceable line on a statement.
 *
 * For each earlier call c, with T the commitments before the close and N the
 * new commitments:
 *
 *   moved(c)         = round( called(c) × N / (T + N) )
 *   late share(j, c) = moved(c) split by new commitment         (plug to the largest)
 *   refund(i, c)     = moved(c) split by what i paid into c      (plug to the largest)
 *   interest(j, c)   = late share(j, c) × rate × days(c) / 365
 *                      days(c) = due date of c → closing date
 *
 * Refunds follow what each investor actually paid into each call, not their
 * commitment, so an investor excused from a call gets nothing back for it, and
 * a call allocated on unfunded commitment is unwound in the same proportions.
 * The part of each call that counted against commitment is moved the same way,
 * so unfunded commitment is restored to those refunded and drawn from those
 * who catch up.
 */

import { allocate } from './allocate';
import { dayBefore, daysBetween } from './dates';
import { feeForRange, type FeeInvestor, type FeeSlice } from './fee-run';
import { fmt, fmtDate, pct as pctText, round } from './format';
import { termsOn, type FundTerms } from './fund-terms';

/** One earlier call, as it was issued. */
export interface PriorCall {
  callNo: number;
  /** When it was payable; interest on a late share runs from here. */
  dueDate: string;
  lines: {
    lpId: string;
    /** Capital paid into this call, management fee excluded. */
    capital: number;
    /** The part of `capital` that counted against commitment. */
    inside: number;
  }[];
}

export interface EqualizationInput {
  closingDate: string;
  /** The first close: when the management fee started. */
  feeStart: string;
  existing: { lpId: string; name: string; commitment: number }[];
  /** New commitments at this close. An existing investor who increases is listed here for the increase. */
  newcomers: {
    lpId: string;
    name: string;
    commitment: number;
    feeRateOverride?: number | null;
    feeExempt?: boolean;
  }[];
  priorCalls: PriorCall[];
  terms: FundTerms[];
  decimals?: number;
}

/** What moved for one investor in one earlier call. */
export interface CallShare {
  callNo: number;
  dueDate: string;
  /** Capital the fund called in this call, from everyone. */
  called: number;
  /** Capital moved to the late investors from this call. */
  moved: number;
  /** + paid by a late investor, − refunded to an earlier one. */
  capital: number;
  /** The part of `capital` that counts against commitment. */
  inside: number;
  /** Days of interest, for a late investor. */
  days: number;
  /** + paid by a late investor, − received by an earlier one. */
  interest: number;
}

export interface EqualizationLine {
  lpId: string;
  name: string;
  role: 'late' | 'earlier' | 'both';
  /** Commitment after the close. */
  commitment: number;
  calls: CallShare[];
  /** + pays, − receives. */
  capital: number;
  inside: number;
  interest: number;
  catchUpFee: number;
  /** How the catch-up fee was reached, for a late investor. */
  feeSlices: FeeSlice[];
  /** What this investor pays (+) or receives (−) in all. */
  net: number;
}

export interface EqualizationCheck {
  level: 'ok' | 'info' | 'warn' | 'fail';
  text: string;
}

export interface EqualizationResult {
  closingDate: string;
  lines: EqualizationLine[];
  totals: {
    commitmentsBefore: number;
    commitmentsNew: number;
    moved: number;
    interest: number;
    catchUpFee: number;
    /** Interest and fee that go to neither side's investors. */
    interestToFund: number;
    interestToGp: number;
    feeToGp: number;
    /** Share of commitment paid in, fund-wide, after the close. */
    paidInPct: number;
    /** The late-close interest rate a year, and how it accrues. Null rate: none. */
    interestRate: number | null;
    interestBasis: 'simple' | 'compound';
  };
  checks: EqualizationCheck[];
}

const TOLERANCE = 0.005;

export function equalize(input: EqualizationInput): EqualizationResult {
  const d = input.decimals ?? 2;
  const terms = termsOn(input.terms, input.closingDate);
  const checks: EqualizationCheck[] = [];

  const T = input.existing.reduce((s, e) => s + e.commitment, 0);
  const N = input.newcomers.reduce((s, n) => s + n.commitment, 0);
  const lines = new Map<string, EqualizationLine>();
  const line = (lpId: string, name: string, role: 'late' | 'earlier'): EqualizationLine => {
    let l = lines.get(lpId);
    if (!l) {
      l = { lpId, name, role, commitment: 0, calls: [], capital: 0, inside: 0, interest: 0, catchUpFee: 0, feeSlices: [], net: 0 };
      lines.set(lpId, l);
    } else if (l.role !== role) {
      l.role = 'both';
    }
    return l;
  };
  for (const e of input.existing) line(e.lpId, e.name, 'earlier').commitment += e.commitment;
  for (const n of input.newcomers) line(n.lpId, n.name, 'late').commitment += n.commitment;

  if (N <= 0) checks.push({ level: 'fail', text: 'Nobody new is committing at this close, so there is nothing to equalize.' });
  if (T <= 0) checks.push({ level: 'fail', text: 'There are no earlier commitments to equalize against.' });

  const rate = terms?.lateCloseInterestRate ?? null;
  const compound = terms?.lateCloseInterestBasis === 'compound';
  const interestTo = terms?.equalizationInterestTo ?? 'existing_lps';
  const plugOf = (parts: { id: string; basis: number }[]) =>
    parts.reduce((a, b) => (b.basis > a.basis ? b : a), parts[0])?.id;

  let movedTotal = 0;
  let interestTotal = 0;
  let interestToFund = 0;
  let interestToGp = 0;
  let calledTotal = 0;

  const calls = [...input.priorCalls].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.callNo - b.callNo);
  if (N > 0 && T > 0) {
    for (const call of calls) {
      const called = call.lines.reduce((s, l) => s + l.capital, 0);
      const calledInside = call.lines.reduce((s, l) => s + l.inside, 0);
      calledTotal += called;
      if (called <= 0) continue;

      const moved = round((called * N) / (T + N), d);
      const movedInside = round((moved * calledInside) / called, d);
      movedTotal += moved;

      const lateParts = input.newcomers.map((n) => ({ id: n.lpId, basis: n.commitment }));
      const late = allocate(moved, lateParts, plugOf(lateParts), d).out;
      const lateIn = allocate(movedInside, lateParts, plugOf(lateParts), d).out;

      const paidParts = call.lines.filter((l) => l.capital > 0).map((l) => ({ id: l.lpId, basis: l.capital }));
      const refund = allocate(moved, paidParts, plugOf(paidParts), d).out;
      const insideParts = call.lines.filter((l) => l.inside > 0).map((l) => ({ id: l.lpId, basis: l.inside }));
      const refundIn = insideParts.length ? allocate(movedInside, insideParts, plugOf(insideParts), d).out : {};

      const days = Math.max(0, daysBetween(call.dueDate, input.closingDate));
      const lateInterest: Record<string, number> = {};
      for (const n of input.newcomers) {
        const share = late[n.lpId] ?? 0;
        const years = days / 365;
        const amount = rate ? round(compound ? share * ((1 + rate) ** years - 1) : share * rate * years, d) : 0;
        lateInterest[n.lpId] = amount;
        interestTotal += amount;
      }
      const callInterest = Object.values(lateInterest).reduce((s, x) => s + x, 0);

      // Interest to the earlier investors follows their refunds for this call.
      const received =
        interestTo === 'existing_lps' && callInterest > 0
          ? allocate(callInterest, paidParts, plugOf(paidParts), d).out
          : {};
      if (interestTo === 'fund') interestToFund += callInterest;
      if (interestTo === 'gp') interestToGp += callInterest;

      for (const n of input.newcomers) {
        const l = lines.get(n.lpId)!;
        l.calls.push({
          callNo: call.callNo,
          dueDate: call.dueDate,
          called,
          moved,
          capital: late[n.lpId] ?? 0,
          inside: lateIn[n.lpId] ?? 0,
          days,
          interest: lateInterest[n.lpId] ?? 0,
        });
      }
      for (const p of paidParts) {
        const l = lines.get(p.id) ?? line(p.id, p.id, 'earlier');
        l.calls.push({
          callNo: call.callNo,
          dueDate: call.dueDate,
          called,
          moved,
          capital: -(refund[p.id] ?? 0),
          inside: -(refundIn[p.id] ?? 0),
          days: 0,
          interest: -(received[p.id] ?? 0),
        });
      }

      const lateSum = Object.values(late).reduce((s, x) => s + x, 0);
      const refundSum = Object.values(refund).reduce((s, x) => s + x, 0);
      if (Math.abs(lateSum - refundSum) > TOLERANCE) {
        checks.push({ level: 'fail', text: `Call ${call.callNo}: late shares ${lateSum} and refunds ${refundSum} do not tie.` });
      }
    }
  }

  // --- The management fee a late investor missed ----------------------------
  const feeTo = terms?.catchUpFeeTo ?? 'gp';
  let feeTotal = 0;
  let feeToGp = 0;
  const feeEnd = dayBefore(input.closingDate);
  if (N > 0 && input.feeStart <= feeEnd) {
    const late: FeeInvestor[] = input.newcomers.map((n) => ({
      lpId: n.lpId,
      name: n.name,
      commitments: [{ from: input.feeStart, amount: n.commitment }],
      feeRateOverride: n.feeRateOverride ?? null,
      feeExempt: n.feeExempt ?? false,
    }));
    const fee = feeForRange(input.feeStart, feeEnd, input.terms, late, d);
    for (const f of fee.lines) {
      const l = lines.get(f.lpId)!;
      l.catchUpFee += f.fee;
      l.feeSlices = f.slices;
      feeTotal += f.fee;
    }
    if (feeTo === 'existing_lps' && feeTotal > 0 && T > 0) {
      const parts = input.existing.map((e) => ({ id: e.lpId, basis: e.commitment }));
      const out = allocate(round(feeTotal, d), parts, plugOf(parts), d).out;
      for (const e of input.existing) lines.get(e.lpId)!.catchUpFee -= out[e.lpId] ?? 0;
    } else {
      feeToGp = round(feeTotal, d);
    }
  }

  // --- Roll up ---------------------------------------------------------------
  for (const l of lines.values()) {
    l.capital = round(l.calls.reduce((s, c) => s + c.capital, 0), d);
    l.inside = round(l.calls.reduce((s, c) => s + c.inside, 0), d);
    l.interest = round(l.calls.reduce((s, c) => s + c.interest, 0), d);
    l.catchUpFee = round(l.catchUpFee, d);
    l.net = round(l.capital + l.interest + l.catchUpFee, d);
  }
  const all = [...lines.values()];

  const paidInPct = T + N > 0 ? calledTotal / (T + N) : 0;

  // --- Proof -----------------------------------------------------------------
  if (N > 0 && T > 0) {
    const paid = all.filter((l) => l.capital > 0).reduce((s, l) => s + l.capital, 0);
    const back = -all.filter((l) => l.capital < 0).reduce((s, l) => s + l.capital, 0);
    checks.push({
      level: Math.abs(paid - back) <= TOLERANCE ? 'ok' : 'fail',
      text: `Late investors pay ${fmt(paid)} of capital; earlier investors get ${fmt(back)} back.`,
    });

    for (const n of input.newcomers) {
      const l = lines.get(n.lpId)!;
      const lateCapital = l.calls.reduce((s, c) => s + Math.max(c.capital, 0), 0);
      const pct = n.commitment > 0 ? lateCapital / n.commitment : 0;
      // A cent per call is the most rounding can move it.
      const within = Math.abs(pct - paidInPct) * n.commitment <= calls.length * 0.01 + TOLERANCE;
      checks.push({
        level: within ? 'ok' : 'fail',
        text: `${n.lpId} has now paid in ${pctText(pct)} of commitment, the same as the fund (${pctText(paidInPct)}).`,
      });
    }

    const interestOut = -all.filter((l) => l.interest < 0).reduce((s, l) => s + l.interest, 0);
    const interestIn = all.filter((l) => l.interest > 0).reduce((s, l) => s + l.interest, 0);
    const kept = interestToFund + interestToGp;
    checks.push({
      level: Math.abs(interestIn - interestOut - kept) <= TOLERANCE ? 'ok' : 'fail',
      text: rate
        ? `Interest at ${pctText(rate)} a year (${compound ? 'compound' : 'simple'}): ${fmt(interestIn)} paid, ${
            interestTo === 'existing_lps' ? 'all to the earlier investors' : interestTo === 'fund' ? 'kept by the fund' : 'to the general partner'
          }.`
        : 'No late-close interest: the fund’s terms set no rate.',
    });

    checks.push({
      level: 'ok',
      text: feeTotal
        ? `Catch-up management fee ${fmt(feeTotal)} from ${fmtDate(input.feeStart)} to ${fmtDate(feeEnd)}, ${feeTo === 'gp' ? 'to the general partner' : 'shared among the earlier investors'}.`
        : 'No catch-up management fee.',
    });

    if (!terms) {
      checks.push({ level: 'warn', text: 'No fund terms are in force on the closing date; interest and the catch-up fee are nil.' });
    }
    if (calls.length === 0) {
      checks.push({ level: 'info', text: 'No calls were issued before this close, so no capital moves; only the catch-up fee applies.' });
    }
  }

  return {
    closingDate: input.closingDate,
    lines: all.sort((a, b) => (a.role === 'late' ? 0 : 1) - (b.role === 'late' ? 0 : 1) || a.lpId.localeCompare(b.lpId)),
    totals: {
      commitmentsBefore: T,
      commitmentsNew: N,
      moved: round(movedTotal, d),
      interest: round(interestTotal, d),
      catchUpFee: round(feeTotal, d),
      interestToFund: round(interestToFund, d),
      interestToGp: round(interestToGp, d),
      feeToGp,
      paidInPct,
      interestRate: rate,
      interestBasis: compound ? 'compound' : 'simple',
    },
    checks,
  };
}

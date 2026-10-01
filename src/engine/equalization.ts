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
 *                      days(c) = due date of c → the closing date here; when
 *                      the terms run it to when the late investor pays, the
 *                      call or statement that collects it works it out again
 *                      to its own due date (`capitalInterest`)
 *
 * The catch-up fee can carry interest too, at the same rate, to the closing:
 * on the whole fee from the first closing, or on each fee period's part from
 * that period's start (`catchUpFeeInterest`).
 *
 * Refunds follow what each investor actually paid into each call, not their
 * commitment, so an investor excused from a call gets nothing back for it, and
 * a call allocated on unfunded commitment is unwound in the same proportions.
 * The part of each call that counted against commitment is moved the same way,
 * so unfunded commitment is restored to those refunded and drawn from those
 * who catch up.
 */

import { allocate } from './allocate';
import { dayAfter, dayBefore, daysBetween } from './dates';
import { feeForRange, type FeeInvestor, type FeeSlice } from './fee-run';
import { fmt, fmtDate, pct as pctText, round } from './format';
import {
  catchUpFeeInterestOf,
  catchUpFeeInterestRateOf,
  interestUntilOf,
  termsOn,
  type CatchUpFeeInterest,
  type EqualizationInterestTo,
  type EqualizationInterestUntil,
  type FundTerms,
} from './fund-terms';

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
  /**
   * The last day the catch-up fee covers: the end of the last fee period
   * already billed to the investors in before (`catchUpFeeThrough`), or the day
   * before the closing. Absent: the day before the closing.
   */
  feeThrough?: string;
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
  /** Which side of the call this is: a late investor catching up, or an earlier one refunded. */
  side?: 'late' | 'earlier';
  /** For an earlier investor: what they paid into this call — what their share of the interest follows. */
  paid?: number;
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
  /** Interest on the catch-up fee: + paid by a late investor, − received. Absent on a closing finalised before it existed. */
  feeInterest?: number;
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
    /** Who the capital interest goes to. Absent on a closing finalised before it was recorded. */
    interestTo?: EqualizationInterestTo;
    /** Where the capital interest stops. Interest above runs to the closing; with 'collection_due_date' the collecting document works it out again. */
    interestUntil?: EqualizationInterestUntil;
    /**
     * The last day the catch-up fee covers. The late investor's fee periods
     * start the day after. Absent on a closing finalised before it was
     * recorded: the day before the closing.
     */
    feeCoveredThrough?: string;
    /** Decimal places it was rounded to. Absent on a closing finalised before it was recorded: 2. */
    decimals?: number;
    /** The date the capital interest above runs to: the closing date, unless `equalizationRunTo` moved it. */
    interestRunTo?: string;
    /** Interest on the catch-up fee, and how it was worked out. */
    feeInterest?: number;
    /** Its rate a year. Absent on a closing finalised before it was recorded: `interestRate`. */
    feeInterestRate?: number | null;
    feeInterestToGp?: number;
    catchUpFeeInterest?: CatchUpFeeInterest;
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
      l = { lpId, name, role, commitment: 0, calls: [], capital: 0, inside: 0, interest: 0, catchUpFee: 0, feeInterest: 0, feeSlices: [], net: 0 };
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

      for (const n of input.newcomers) {
        const l = lines.get(n.lpId)!;
        l.calls.push({
          callNo: call.callNo,
          dueDate: call.dueDate,
          called,
          moved,
          capital: late[n.lpId] ?? 0,
          inside: lateIn[n.lpId] ?? 0,
          days: 0,
          interest: 0,
          side: 'late',
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
          interest: 0,
          side: 'earlier',
          paid: p.basis,
        });
      }

      const lateSum = Object.values(late).reduce((s, x) => s + x, 0);
      const refundSum = Object.values(refund).reduce((s, x) => s + x, 0);
      if (Math.abs(lateSum - refundSum) > TOLERANCE) {
        checks.push({ level: 'fail', text: `Call ${call.callNo}: late shares ${lateSum} and refunds ${refundSum} do not tie.` });
      }
    }
  }

  // Interest on the capital, to the closing date: one calculation, shared with
  // the call or statement that collects it when the terms run it to then.
  if (N > 0 && T > 0) {
    const worked = interestOnCalls([...lines.values()], input.closingDate, { rate, compound, to: interestTo }, d);
    for (const l of lines.values()) {
      for (const c of l.calls) {
        const x = worked.byCall.get(l.lpId)?.get(`${c.side}|${c.callNo}`);
        if (!x) continue;
        c.interest = x.interest;
        c.days = x.days;
      }
    }
    interestTotal = worked.paid;
    interestToFund = worked.toFund;
    interestToGp = worked.toGp;
  }

  // --- The management fee a late investor missed ----------------------------
  const feeTo = terms?.catchUpFeeTo ?? 'gp';
  let feeTotal = 0;
  let feeToGp = 0;
  const feeEnd = input.feeThrough ?? dayBefore(input.closingDate);
  // Who shares the catch-up fee, and so its interest, when the earlier investors get it.
  const feeParts = input.existing.map((e) => ({ id: e.lpId, basis: e.commitment }));
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
      const out = allocate(round(feeTotal, d), feeParts, plugOf(feeParts), d).out;
      for (const e of input.existing) lines.get(e.lpId)!.catchUpFee -= out[e.lpId] ?? 0;
    } else {
      feeToGp = round(feeTotal, d);
    }
  }

  // --- Interest on the catch-up fee, to the closing ---------------------------
  // At the late-close rate: on the whole fee from the first closing, or on each
  // fee period's part from that period's start. It goes where the fee goes.
  const feeInterestMode = catchUpFeeInterestOf(terms);
  const feeRate = catchUpFeeInterestRateOf(terms);
  let feeInterestTotal = 0;
  let feeInterestToGp = 0;
  if (feeRate && feeInterestMode !== 'none' && feeTotal > 0) {
    const grow = (amount: number, from: string) => {
      const years = Math.max(0, daysBetween(from, input.closingDate)) / 365;
      return compound ? amount * ((1 + feeRate) ** years - 1) : amount * feeRate * years;
    };
    for (const n of input.newcomers) {
      const l = lines.get(n.lpId)!;
      const lateFee = l.feeSlices.reduce((t, x) => t + x.amount, 0);
      if (!lateFee) continue;
      const amount = round(
        feeInterestMode === 'first_close' ? grow(lateFee, input.feeStart) : l.feeSlices.reduce((t, x) => t + grow(x.amount, x.from), 0),
        d,
      );
      l.feeInterest = (l.feeInterest ?? 0) + amount;
      feeInterestTotal += amount;
    }
    feeInterestTotal = round(feeInterestTotal, d);
    if (feeTo === 'existing_lps' && T > 0 && feeInterestTotal > 0) {
      const out = allocate(feeInterestTotal, feeParts, plugOf(feeParts), d).out;
      for (const e of input.existing) {
        const l = lines.get(e.lpId)!;
        l.feeInterest = (l.feeInterest ?? 0) - (out[e.lpId] ?? 0);
      }
    } else {
      feeInterestToGp = feeInterestTotal;
    }
  }

  // --- Roll up ---------------------------------------------------------------
  for (const l of lines.values()) {
    l.capital = round(l.calls.reduce((s, c) => s + c.capital, 0), d);
    l.inside = round(l.calls.reduce((s, c) => s + c.inside, 0), d);
    l.interest = round(l.calls.reduce((s, c) => s + c.interest, 0), d);
    l.catchUpFee = round(l.catchUpFee, d);
    l.feeInterest = round(l.feeInterest ?? 0, d);
    l.net = round(l.capital + l.interest + l.catchUpFee + l.feeInterest, d);
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
        ? `Catch-up management fee ${fmt(feeTotal)} from ${fmtDate(input.feeStart)} to ${fmtDate(feeEnd)}, ${feeTo === 'gp' ? 'to the general partner' : 'shared among the earlier investors'}.${
            input.feeThrough !== undefined && feeEnd !== dayBefore(input.closingDate)
              ? ` That is the fee periods already billed to the investors in before; from ${fmtDate(dayAfter(feeEnd))} the late investors are billed with everyone else.`
              : ''
          }`
        : feeEnd < input.feeStart
          ? 'No catch-up management fee: no fee period had been billed before this closing, so the late investors are billed every period in full with everyone else.'
          : 'No catch-up management fee.',
    });
    if (feeInterestTotal) {
      checks.push({
        level: 'ok',
        text: `Interest on the catch-up fee ${fmt(feeInterestTotal)} at ${pctText(feeRate!)} a year, ${
          feeInterestMode === 'first_close' ? `from ${fmtDate(input.feeStart)}` : 'from each fee period’s start'
        } to ${fmtDate(input.closingDate)}, ${feeTo === 'gp' ? 'to the general partner' : 'shared among the earlier investors'}.`,
      });
    }
    if (interestUntilOf(terms) === 'collection_due_date' && interestTotal) {
      checks.push({
        level: 'info',
        text: 'Interest on capital is shown to the closing date. The call or statement that collects it works it out to its own due date.',
      });
    }

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
      decimals: d,
      feeCoveredThrough: feeEnd,
      interestTo,
      interestUntil: interestUntilOf(terms),
      feeInterest: feeInterestTotal,
      feeInterestRate: feeRate,
      feeInterestToGp,
      catchUpFeeInterest: feeInterestMode,
    },
    checks,
  };
}

/** The rounding residual of an equalization split goes to the largest share. */
const plugOf = (parts: { id: string; basis: number }[]) => parts.reduce((a, b) => (b.basis > a.basis ? b : a), parts[0])?.id;

/**
 * Interest on the capital moved at a later close, from each earlier call's due
 * date to `until`: what each late investor pays, per call, and how it is shared
 * among the investors who hold that call (by what each holds of it), or kept
 * by the fund or the general partner.
 *
 * The one calculation of it: `equalize` runs it to the closing date, and the
 * call or statement that collects the equalization runs it again to its own due
 * date, from the capital shares frozen at finalising.
 */
export function interestOnCalls(
  lines: Pick<EqualizationLine, 'lpId' | 'calls'>[],
  until: string,
  how: { rate: number | null; compound: boolean; to: EqualizationInterestTo },
  d = 2,
): {
  byCall: Map<string, Map<string, { interest: number; days: number }>>;
  byLp: Record<string, number>;
  paid: number;
  toFund: number;
  toGp: number;
} {
  const byCall = new Map<string, Map<string, { interest: number; days: number }>>();
  const byLp: Record<string, number> = {};
  const put = (lpId: string, key: string, interest: number, days: number) => {
    const m = byCall.get(lpId) ?? new Map();
    m.set(key, { interest, days });
    byCall.set(lpId, m);
    byLp[lpId] = round((byLp[lpId] ?? 0) + interest, d);
  };
  const sideOf = (c: CallShare) => c.side ?? (c.capital > 0 ? 'late' : 'earlier');
  // Every earlier call, with its late shares and the earlier investors who paid it.
  const calls = new Map<number, { dueDate: string; late: { id: string; share: number }[]; paid: { id: string; basis: number }[] }>();
  for (const l of lines) {
    for (const c of l.calls) {
      const e = calls.get(c.callNo) ?? { dueDate: c.dueDate, late: [], paid: [] };
      if (sideOf(c) === 'late') e.late.push({ id: l.lpId, share: c.capital });
      else e.paid.push({ id: l.lpId, basis: c.paid ?? -c.capital });
      calls.set(c.callNo, e);
    }
  }

  let paid = 0;
  let toFund = 0;
  let toGp = 0;
  for (const [callNo, call] of [...calls].sort((a, b) => a[1].dueDate.localeCompare(b[1].dueDate) || a[0] - b[0])) {
    const days = Math.max(0, daysBetween(call.dueDate, until));
    const years = days / 365;
    let callInterest = 0;
    for (const j of call.late) {
      const amount = how.rate ? round(how.compound ? j.share * ((1 + how.rate) ** years - 1) : j.share * how.rate * years, d) : 0;
      put(j.id, `late|${callNo}`, amount, days);
      callInterest += amount;
    }
    paid += callInterest;
    const received = how.to === 'existing_lps' && callInterest > 0 && call.paid.length ? allocate(callInterest, call.paid, plugOf(call.paid), d).out : {};
    if (how.to === 'fund') toFund += callInterest;
    if (how.to === 'gp') toGp += callInterest;
    for (const p of call.paid) put(p.id, `earlier|${callNo}`, -(received[p.id] ?? 0), 0);
  }
  return { byCall, byLp, paid: round(paid, d), toFund: round(toFund, d), toGp: round(toGp, d) };
}

/**
 * A finalised equalization with its capital interest run to `until` instead
 * of the closing date: each call's days and interest, each investor's interest
 * and net, and the totals. Worked out from the frozen capital shares, rate and
 * basis — the closing is not equalized again, so capital and the catch-up fee
 * are exactly as finalised, and rounded as it was. `until` on or before the
 * closing date gives the result back unchanged.
 */
export function equalizationRunTo(result: EqualizationResult, until: string): EqualizationResult {
  if (until <= result.closingDate) return result;
  const d = result.totals.decimals ?? 2;
  const worked = interestOnCalls(
    result.lines,
    until,
    { rate: result.totals.interestRate, compound: result.totals.interestBasis === 'compound', to: result.totals.interestTo ?? 'existing_lps' },
    d,
  );
  const lines = result.lines.map((l) => {
    const calls = l.calls.map((c) => {
      const x = worked.byCall.get(l.lpId)?.get(`${c.side ?? (c.capital > 0 ? 'late' : 'earlier')}|${c.callNo}`);
      return x ? { ...c, days: x.days, interest: x.interest } : c;
    });
    const interest = round(calls.reduce((t, c) => t + c.interest, 0), d);
    return { ...l, calls, interest, net: round(l.capital + interest + l.catchUpFee + (l.feeInterest ?? 0), d) };
  });
  return {
    ...result,
    lines,
    totals: { ...result.totals, interest: worked.paid, interestToFund: worked.toFund, interestToGp: worked.toGp, interestRunTo: until },
  };
}

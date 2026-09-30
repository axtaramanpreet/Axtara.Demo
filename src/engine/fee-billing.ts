/**
 * Billing the management fee on capital calls, period by period.
 *
 * A period's fee is worked out from the fund's record (`feeRunFor`): each
 * investor's commitment, side letter and joining date through that period. A
 * call bills what is still owed for the periods it names — the period's fee as
 * the record stands, less what calls already sent billed for it. One rule does
 * several jobs:
 *
 *   - Nothing is billed twice: a period already billed in full owes nothing.
 *   - A fund that paid its fee from a credit line can bill several past
 *     periods on one call.
 *   - Someone admitted at a later close part-way through a billed period still
 *     owes their share of it, and the next call can bill it.
 *
 * A negative remainder — billed more than the record now says — is a credit
 * due. It is reported, not billed; crediting it is a later step.
 */

import { dayAfter, dayBefore } from './dates';
import { feePeriodsFor, feeRunFor, type FeePeriod, type FundHistory } from './fund-history';
import { trueUp, type FeeResult, type TrueUpLine } from './fee-run';
import { fmt, round } from './format';
import { termsOn, type FundTerms } from './fund-terms';
import type { FeeScheduleEntry } from './types';

export interface PeriodOwed {
  period: FeePeriod;
  /** The period's fee per investor, as the record stands. */
  now: Record<string, number>;
  /** What sent calls billed for it, per investor. */
  billed: Record<string, number>;
  /** Which sent calls billed it, and how much each. */
  billedOn: { callNo: number; amount: number }[];
  /** Still to bill (+) or billed too much (−), per investor. */
  owed: Record<string, number>;
  /** The positive remainders, added up: what a call naming this period bills. */
  owedTotal: number;
  /** The negative remainders, added up, as a positive figure. */
  creditTotal: number;
}

const key = (from: string, to: string) => `${from}|${to}`;

/**
 * Every fee period from the first close to the one containing `through`, with
 * what it owes. `excludeCallNo` leaves one call out of what was billed — the
 * call being set up, whose own schedule is what is being worked out.
 */
export function feeOwed(history: FundHistory, through: string, excludeCallNo?: number): PeriodOwed[] {
  const periods = feePeriodsFor(history, through);
  const decimals = termsOn(history.terms, through)?.roundingDecimals ?? 2;
  const r = (n: number) => round(n, decimals);
  const containing = (date: string) => periods.find((p) => p.from <= date && date <= p.to);

  // What sent calls billed, by period. A call with a schedule billed exactly
  // it; one without charged rate × share of a year, for the period its date
  // falls in.
  const billed = new Map<string, { byLp: Record<string, number>; on: Map<number, number> }>();
  const addBilled = (p: FeePeriod | undefined, callNo: number, byLp: Record<string, number>) => {
    if (!p) return;
    const k = key(p.from, p.to);
    const b = billed.get(k) ?? { byLp: {} as Record<string, number>, on: new Map<number, number>() };
    for (const [lp, amount] of Object.entries(byLp)) {
      if (!amount) continue;
      b.byLp[lp] = r((b.byLp[lp] ?? 0) + amount);
      b.on.set(callNo, r((b.on.get(callNo) ?? 0) + amount));
    }
    billed.set(k, b);
  };
  for (const c of history.calls) {
    if (c.callNo === excludeCallNo) continue;
    if (c.feeSchedule) {
      for (const e of c.feeSchedule) addBilled(periods.find((p) => p.from === e.from && p.to === e.to) ?? containing(e.from), c.callNo, e.byLp);
    } else {
      addBilled(containing(c.callDate), c.callNo, Object.fromEntries(c.lines.map((l) => [l.lpId, r(l.total - l.capital)])));
    }
  }

  return periods.map((period) => {
    const now = Object.fromEntries(feeRunFor(history, period.from, period.to).lines.map((l) => [l.lpId, l.fee]));
    const b = billed.get(key(period.from, period.to));
    const was = b?.byLp ?? {};
    const owed: Record<string, number> = {};
    for (const lp of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const left = r((now[lp] ?? 0) - (was[lp] ?? 0));
      if (Math.abs(left) >= 0.005) owed[lp] = left;
    }
    const values = Object.values(owed);
    return {
      period,
      now,
      billed: was,
      billedOn: [...(b?.on ?? new Map())].map(([callNo, amount]) => ({ callNo, amount })).sort((x, y) => x.callNo - y.callNo),
      owed,
      owedTotal: r(values.filter((v) => v > 0).reduce((t, v) => t + v, 0)),
      creditTotal: r(-values.filter((v) => v < 0).reduce((t, v) => t + v, 0)),
    };
  });
}

/** The schedule a call bills for the periods chosen: each one's positive remainders. */
export function buildFeeSchedule(owed: PeriodOwed[], chosen: { from: string; to: string }[]): FeeScheduleEntry[] {
  const wanted = new Set(chosen.map((c) => key(c.from, c.to)));
  return owed
    .filter((o) => wanted.has(key(o.period.from, o.period.to)))
    .map((o) => ({
      from: o.period.from,
      to: o.period.to,
      label: o.period.label,
      byLp: Object.fromEntries(Object.entries(o.owed).filter(([, v]) => v > 0)),
    }));
}

/**
 * The periods a new call bills unless told otherwise. Billed in advance: the
 * period the call falls in. In arrears: the latest period that has ended. Only
 * a period that still owes something.
 */
export function defaultFeePeriods(owed: PeriodOwed[], callDate: string, timing: 'advance' | 'arrears' | null): { from: string; to: string }[] {
  const pick =
    timing === 'arrears'
      ? [...owed].reverse().find((o) => o.period.to < callDate)
      : owed.find((o) => o.period.from <= callDate && callDate <= o.period.to);
  return pick && pick.owedTotal > 0 ? [{ from: pick.period.from, to: pick.period.to }] : [];
}

/**
 * Where a call's stored schedule no longer matches what its periods owe —
 * someone else billed one first, a closing changed a fee. Empty when it
 * matches. In words, for refusing to approve a stale call.
 */
export function feeScheduleDifferences(stored: FeeScheduleEntry[], fresh: FeeScheduleEntry[]): string[] {
  const out: string[] = [];
  for (const s of stored) {
    const f = fresh.find((x) => x.from === s.from && x.to === s.to);
    const lps = new Set([...Object.keys(s.byLp), ...Object.keys(f?.byLp ?? {})]);
    for (const lp of [...lps].sort()) {
      const a = s.byLp[lp] ?? 0;
      const b = f?.byLp[lp] ?? 0;
      if (Math.abs(a - b) >= 0.005) out.push(`${s.label}: ${lp}'s fee is ${fmt(a)} on this call, but ${fmt(b)} is what is owed now.`);
    }
  }
  return out;
}

/** "Q2 2026", "Q2–Q3 2026", "Q4 2025 – Q1 2026": the periods a schedule bills, in a few words. */
export function scheduleLabel(schedule: { label: string; from: string; to: string }[]): string {
  if (!schedule.length) return '';
  const sorted = [...schedule].sort((a, b) => a.from.localeCompare(b.from));
  const contiguous = sorted.every((e, i) => i === 0 || e.from === dayAfter(sorted[i - 1].to));
  if (sorted.length === 1) return sorted[0].label;
  if (!contiguous) return sorted.map((e) => e.label).join(', ');
  const [first, last] = [sorted[0].label, sorted[sorted.length - 1].label];
  const [fq, fy] = first.split(' ');
  const [lq, ly] = last.split(' ');
  return fy === ly && fq && lq ? `${fq}–${lq} ${fy}` : `${first} – ${last}`;
}

export interface FeeLedgerEntry {
  period: FeePeriod;
  /** The fee as the record stands today. */
  now: FeeResult;
  /** The calls that billed it, and how much each. */
  billedOn: { callNo: number; amount: number }[];
  /** What the period still owes (+), and what it was billed beyond what it owes, as a positive credit. */
  owedTotal: number;
  creditTotal: number;
  /**
   * Once a call billed the period: what each investor was billed against what
   * the record now says, and the difference. Null while nothing billed it.
   */
  drift: TrueUpLine[] | null;
  /**
   * Not billed: no call has billed it yet. Billed: calls billed exactly what it
   * costs. True-up due: it was billed, and the record has moved since — someone
   * joined part-way, a side letter arrived, the terms were corrected.
   */
  status: 'not_billed' | 'billed' | 'true_up_due';
}

/**
 * Every fee period from the first close to `through`, worked out from the
 * record and compared with what calls billed. Nothing is entered by hand: a
 * period is billed when a call bills it, and moves to true-up due on its own
 * when the record changes after.
 */
export function feeLedgerFor(history: FundHistory, through: string): FeeLedgerEntry[] {
  const owed = new Map(feeOwed(history, through).map((o) => [`${o.period.from}|${o.period.to}`, o]));
  return feePeriodsFor(history, through).map((period) => {
    const now = feeRunFor(history, period.from, period.to);
    const decimals = termsOn(history.terms, period.from)?.roundingDecimals ?? 2;
    const o = owed.get(`${period.from}|${period.to}`);
    const billedOn = o?.billedOn ?? [];
    const names = new Map(now.lines.map((l) => [l.lpId, l.name]));
    const drift = billedOn.length
      ? trueUp(Object.entries(o!.billed).map(([lpId, fee]) => ({ lpId, name: names.get(lpId) ?? lpId, fee })), now, decimals)
      : null;
    const status = !drift ? 'not_billed' : drift.every((l) => l.trueUp === 0) ? 'billed' : 'true_up_due';
    return { period, now, billedOn, owedTotal: o?.owedTotal ?? 0, creditTotal: o?.creditTotal ?? 0, drift, status };
  });
}

export interface TermsEditImpact {
  /** The dates the edit governs: from its date to the next later change, or open-ended. */
  from: string;
  to: string | null;
  /** Sent, and so kept exactly as sent. */
  issuedCalls: { callNo: number; callDate: string }[];
  /** Finalised with an equalization, and so kept as finalised. */
  closings: { closingNo: number; closingDate: string }[];
  /** Billed periods whose fee the edit moves: what calls billed, what it becomes, the true-up. */
  billedPeriods: { label: string; from: string; to: string; billed: number; becomes: number; trueUp: number }[];
}

/**
 * What an edit to the terms would touch, before it is recorded.
 *
 * Nothing issued is rewritten: a sent call and a finalised closing stay as
 * they are, and are listed so the person knows which documents went out under
 * the old terms. A period a call billed whose fee the edit moves shows the
 * true-up it will be due.
 */
export function termsEditImpact(history: FundHistory, rows: Omit<FundTerms, 'createdAt'>[], today: string): TermsEditImpact {
  const from = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0].effectiveFrom;
  const next = history.terms
    .map((t) => t.effectiveFrom)
    .filter((d) => d > from && !rows.some((r) => r.effectiveFrom === d))
    .sort()[0];
  const to = next ? dayBefore(next) : null;
  const inRange = (d: string) => d >= from && (!to || d <= to);

  // Entered now, so the proposed rows win any tie with what is recorded.
  const stamp = '9999-12-31T23:59:59Z';
  const proposed: FundHistory = { ...history, terms: [...history.terms, ...rows.map((r) => ({ ...r, createdAt: stamp }))] };
  const before = new Map(feeLedgerFor(history, today).map((e) => [`${e.period.from}|${e.period.to}`, e]));

  const billedPeriods = feeLedgerFor(proposed, today)
    .filter((e) => e.billedOn.length)
    .flatMap((e) => {
      const was = before.get(`${e.period.from}|${e.period.to}`);
      if (!was || Math.abs(was.now.total - e.now.total) < 0.005) return [];
      const billed = e.billedOn.reduce((t, b) => t + b.amount, 0);
      const decimals = termsOn(proposed.terms, e.period.from)?.roundingDecimals ?? 2;
      const r = (n: number) => Number(n.toFixed(decimals));
      return [{ label: e.period.label, from: e.period.from, to: e.period.to, billed: r(billed), becomes: e.now.total, trueUp: r(e.now.total - billed) }];
    });

  return {
    from,
    to,
    issuedCalls: history.calls.filter((c) => inRange(c.callDate)).map((c) => ({ callNo: c.callNo, callDate: c.callDate })),
    closings: history.closings
      .filter((c) => c.finalised && c.result && inRange(c.closingDate))
      .map((c) => ({ closingNo: c.closingNo, closingDate: c.closingDate })),
    billedPeriods,
  };
}

export interface CatchUpFee {
  closingId: string;
  closingNo: number;
  closingDate: string;
  /** The dates it covers: from when the fee started to the day before the closing. */
  from: string;
  to: string;
  /** Who it goes to, as the terms said on the closing date. */
  recipient: 'manager' | 'existing_lps';
  /** What each late investor pays for the time before they joined. */
  paidBy: { lpId: string; name: string; fee: number }[];
  /** What each earlier investor receives, when it goes to them. Empty when it goes to the manager. */
  receivedBy: { lpId: string; name: string; fee: number }[];
  total: number;
  /** The part that is the manager's fee income: all of it, or none. */
  toManager: number;
  /** Interest late investors paid on it, which goes where the fee goes. Interest, not fee income. */
  interest: number;
}

/**
 * The management fee late investors paid, at each finalised later closing, for
 * the time before they joined — read from the frozen equalization.
 *
 * It is not part of any fee period's figure: those count an investor from the
 * day they joined. When the terms give it to the manager it is fee income on
 * top of the periods; when they give it to the investors already in, it only
 * moves money between investors, and the manager's fee is unchanged.
 */
export function catchUpFeesFor(history: FundHistory): CatchUpFee[] {
  const out: CatchUpFee[] = [];
  for (const c of [...history.closings].sort((a, b) => a.closingDate.localeCompare(b.closingDate))) {
    const result = c.finalised ? c.result : null;
    if (!result || !(result.totals.catchUpFee > 0)) continue;
    const decimals = termsOn(history.terms, c.closingDate)?.roundingDecimals ?? 2;
    const paid = new Map<string, number>();
    const slices = result.lines.flatMap((l) => l.feeSlices);
    for (const l of result.lines) {
      if (l.feeSlices.length) paid.set(l.lpId, round(l.feeSlices.reduce((s, x) => s + x.amount, 0), decimals));
    }
    const toManager = round(result.totals.feeToGp, decimals);
    const recipient = toManager > 0 ? 'manager' : 'existing_lps';
    out.push({
      closingId: c.id,
      closingNo: c.closingNo,
      closingDate: c.closingDate,
      from: slices.reduce((m, s) => (s.from < m ? s.from : m), slices[0]?.from ?? c.closingDate),
      to: slices.reduce((m, s) => (s.to > m ? s.to : m), slices[0]?.to ?? dayBefore(c.closingDate)),
      recipient,
      paidBy: result.lines.filter((l) => paid.has(l.lpId)).map((l) => ({ lpId: l.lpId, name: l.name, fee: paid.get(l.lpId)! })),
      // What an investor receives is what they would pay less what they do pay:
      // for an earlier investor that is minus their (negative) catch-up fee; for
      // one who both was in and added commitment, the two net.
      receivedBy:
        recipient === 'manager'
          ? []
          : result.lines
              .map((l) => ({ lpId: l.lpId, name: l.name, fee: round((paid.get(l.lpId) ?? 0) - l.catchUpFee, decimals) }))
              .filter((l) => l.fee > 0),
      total: round(result.totals.catchUpFee, decimals),
      toManager,
      interest: round(result.totals.feeInterest ?? 0, decimals),
    });
  }
  return out;
}

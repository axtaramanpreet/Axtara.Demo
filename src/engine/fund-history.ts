/**
 * A fund's history, turned into what each calculation needs.
 *
 * Closings, issued calls and the fund's terms are the record. This reads them
 * the same way every time: for a closing, who was already in, who is new and
 * which calls came first; for a date, where each investor stands; for a fee
 * run, each investor's commitments and invested capital as they changed.
 *
 * Only finalised closings are history. A draft closing is included only where
 * asked for — to preview its own equalization — and never counts towards
 * anything else.
 */

import type { EqualizationInput, EqualizationResult, PriorCall } from './equalization';
import { feeForRange, type DatedAmount, type FeeInvestor, type FeeResult } from './fee-run';
import { dayAfter, dayBefore, periodContaining, periodLabel, periodMonths } from './dates';
import { round } from './format';
import { equalizationForStatement } from './equalization-billing';
import { catchUpFeeUntilOf, termsOn, type FundTerms } from './fund-terms';
import { positionsAsOf, type IssuedCall, type Position } from './positions';

export interface ClosingRecord {
  id: string;
  closingNo: number;
  closingDate: string;
  finalised: boolean;
  commitments: {
    lpId: string;
    name: string;
    amount: number;
    feeRateOverride: number | null;
    feeExempt: boolean;
    /** Where their notices go, if the closing recorded it. */
    contactEmail?: string | null;
  }[];
  /** The frozen equalization, for a finalised later closing. */
  result: EqualizationResult | null;
  /**
   * How its equalization is settled: statements now, or on the next capital
   * call. Absent or null: not chosen yet.
   */
  settlement?: Settlement | null;
  /**
   * Settled now: the date its sent statements are payable by, which the
   * interest runs to. Absent or null: none sent, or sent before it was recorded.
   */
  statementDueDate?: string | null;
}

export type Settlement = 'on_closing' | 'next_call';

export interface FundHistory {
  terms: FundTerms[];
  closings: ClosingRecord[];
  calls: IssuedCall[];
}

const byDate = (a: ClosingRecord, b: ClosingRecord) =>
  a.closingDate.localeCompare(b.closingDate) || a.closingNo - b.closingNo;

/** The first close: when the fund started, and the management fee with it. */
export function firstClosing(history: FundHistory): ClosingRecord | null {
  return [...history.closings].sort(byDate)[0] ?? null;
}

/**
 * Each investor's dated commitments, from finalised closings — plus one draft
 * closing, when previewing it.
 */
export function commitmentsFrom(
  history: FundHistory,
  includeDraft?: string,
): Record<string, { name: string; changes: DatedAmount[] }> {
  const out: Record<string, { name: string; changes: DatedAmount[] }> = {};
  for (const c of [...history.closings].sort(byDate)) {
    if (!c.finalised && c.id !== includeDraft) continue;
    for (const k of c.commitments) {
      (out[k.lpId] ??= { name: k.name, changes: [] }).changes.push({ from: c.closingDate, amount: k.amount });
      out[k.lpId].name = k.name;
    }
  }
  return out;
}

/**
 * The last day a later closing's catch-up fee covers.
 *
 * By default (`catchUpFeeUntil` blank or 'billed_periods'), the fee periods
 * already billed to the investors in before: the end of the latest period a
 * call dated before the closing billed — so every later period bills the late
 * investor in full, with everyone else, and nobody's period figures differ.
 * Nothing billed yet: the day before the first close, so no catch-up at all. A
 * period billed before the closing is covered whole, even past the closing
 * date. With 'closing_date', every day up to the closing.
 */
export function catchUpFeeThrough(history: FundHistory, closing: Pick<ClosingRecord, 'closingDate'>): string {
  if (catchUpFeeUntilOf(termsOn(history.terms, closing.closingDate)) === 'closing_date') return dayBefore(closing.closingDate);
  const first = firstClosing(history);
  const billed = history.calls
    .filter((call) => call.callDate < closing.closingDate)
    .flatMap((call) => (call.feeSchedule ?? []).filter((e) => Object.values(e.byLp).some((x) => x !== 0)).map((e) => e.to));
  const none = dayBefore(first?.closingDate ?? closing.closingDate);
  return billed.reduce((m, to) => (to > m ? to : m), none);
}

/**
 * What a later closing's equalization is worked out from. Null for the first
 * close, which admits everyone at the start and so has nothing to equalize.
 */
export function equalizationInputFor(history: FundHistory, closingId: string): EqualizationInput | null {
  const closing = history.closings.find((c) => c.id === closingId);
  const first = firstClosing(history);
  if (!closing || !first || closing.id === first.id) return null;

  const before = history.closings.filter((c) => c.finalised && byDate(c, closing) < 0);
  const existing = new Map<string, { lpId: string; name: string; commitment: number }>();
  for (const c of before) {
    for (const k of c.commitments) {
      const e = existing.get(k.lpId) ?? { lpId: k.lpId, name: k.name, commitment: 0 };
      e.commitment += k.amount;
      existing.set(k.lpId, e);
    }
  }

  // What each investor holds of each earlier call: what they paid into it, as
  // moved by every earlier closing's equalization. An investor admitted at a
  // second close holds their share of the first call from then on, so a third
  // close refunds them too — not only those who paid on the day.
  const earlierResults = before.flatMap((c) => (c.result ? [c.result] : []));
  const d = termsOn(history.terms, closing.closingDate)?.roundingDecimals ?? 2;
  const priorCalls: PriorCall[] = history.calls
    .filter((call) => call.callDate < closing.closingDate)
    .map((call) => {
      const held = new Map(call.lines.map((l) => [l.lpId, { lpId: l.lpId, capital: l.capital, inside: l.inside }]));
      for (const r of earlierResults) {
        for (const l of r.lines) {
          for (const share of l.calls.filter((x) => x.callNo === call.callNo)) {
            const h = held.get(l.lpId) ?? { lpId: l.lpId, capital: 0, inside: 0 };
            h.capital += share.capital;
            h.inside += share.inside;
            held.set(l.lpId, h);
          }
        }
      }
      return {
        callNo: call.callNo,
        dueDate: call.dueDate,
        lines: [...held.values()].map((h) => ({ ...h, capital: round(h.capital, d), inside: round(h.inside, d) })),
      };
    });

  return {
    closingDate: closing.closingDate,
    feeStart: first.closingDate,
    feeThrough: catchUpFeeThrough(history, closing),
    existing: [...existing.values()],
    newcomers: closing.commitments.map((k) => ({
      lpId: k.lpId,
      name: k.name,
      commitment: k.amount,
      feeRateOverride: k.feeRateOverride,
      feeExempt: k.feeExempt,
    })),
    priorCalls,
    terms: history.terms,
  };
}

/** A finalised closing's equalization, as it moved one investor's balances. */
export interface EqualizationMovement {
  closingId: string;
  closingNo: number;
  /** When it moved: the closing date, or the call that settled it. */
  date: string;
  /** The sent call it moved on, when it moved on a call. */
  onCall?: number;
  lpId: string;
  name: string;
  /** Into paid-in: capital and catch-up fee. */
  paid: number;
  /** The part of `paid` that counts against commitment. */
  drawn: number;
  /** Late-close interest, and interest on the catch-up fee: not capital, so no balance moves. */
  interest: number;
  /** What they paid (+) or got back (−) in all. */
  net: number;
}

/**
 * When and how each finalised closing's equalization moved the balances.
 *
 * Settled by statement, or not chosen yet: on the closing date. Settled on the
 * next call: on that call, once it is sent — until then the late investor has
 * paid nothing and all their commitment is unfunded. A call sent before that
 * rule (its schedule has no `settles`) moved them on the closing date, and
 * keeps doing so.
 *
 * `positionsOn` and `capitalAccount` both read this, so they end on the same
 * figures. Invested capital is not here: it stays dated at the closing.
 */
export function equalizationMovements(history: FundHistory): EqualizationMovement[] {
  const out: EqualizationMovement[] = [];
  for (const c of history.closings) {
    if (!c.finalised || !c.result) continue;
    const feeReduces = termsOn(history.terms, c.closingDate)?.feeReducesUnfunded ?? true;
    const names = new Map(c.result.lines.map((l) => [l.lpId, l.name]));
    // Settled now, with interest run to the date its statements are payable by.
    const asked = c.settlement === 'on_closing' && c.statementDueDate ? equalizationForStatement(c.result, c.statementDueDate) : c.result;
    const atClosing = () => {
      for (const l of asked.lines) {
        out.push({
          closingId: c.id,
          closingNo: c.closingNo,
          date: c.closingDate,
          lpId: l.lpId,
          name: l.name,
          paid: l.capital + l.catchUpFee,
          drawn: l.inside + (feeReduces ? l.catchUpFee : 0),
          interest: l.interest + (l.feeInterest ?? 0),
          net: l.net,
        });
      }
    };
    if (c.settlement !== 'next_call') {
      atClosing();
      continue;
    }
    const carriers = history.calls
      .map((call) => ({ call, entry: call.equalizationSchedule?.find((e) => e.closingId === c.id) }))
      .filter((x): x is { call: IssuedCall; entry: NonNullable<typeof x.entry> } => !!x.entry);
    if (carriers.some((x) => !x.entry.settles)) {
      atClosing();
      continue;
    }
    for (const { call, entry } of carriers) {
      for (const [lpId, p] of Object.entries(entry.parts)) {
        const feeInterest = p.feeInterest ?? 0;
        out.push({
          closingId: c.id,
          closingNo: c.closingNo,
          date: call.callDate,
          onCall: call.callNo,
          lpId,
          name: names.get(lpId) ?? lpId,
          paid: p.capital + p.catchUpFee,
          drawn: (p.inside ?? 0) + (entry.feeReducesUnfunded ? p.catchUpFee : 0),
          interest: p.interest + feeInterest,
          net: p.capital + p.interest + p.catchUpFee + feeInterest,
        });
      }
    }
  }
  return out;
}

/** Where every investor stands on `date`, from the record. */
export function positionsOn(history: FundHistory, date: string): Position[] {
  const hasClosings = history.closings.some((c) => c.finalised);
  return positionsAsOf(date, {
    calls: history.calls,
    equalizations: history.closings
      .filter((c) => c.finalised && c.result)
      .map((c) => ({ closingDate: c.closingDate, lines: c.result!.lines })),
    movements: equalizationMovements(history),
    commitments: hasClosings ? commitmentsFrom(history) : undefined,
  });
}

/**
 * Every investor as the management fee sees them: commitments dated by the closing that
 * admitted them, invested capital dated by the call that drew it, and the
 * side-letter rate or exemption from their latest commitment that set one.
 *
 * A fund with no closings (its register came from a workbook) is read from its
 * latest call instead, as committed from the start.
 */
export function feeInvestorsFrom(history: FundHistory): FeeInvestor[] {
  const out = new Map<string, FeeInvestor>();
  const at = (lpId: string, name: string) => {
    let i = out.get(lpId);
    if (!i) {
      i = { lpId, name, commitments: [], invested: [], feeRateOverride: null, feeExempt: false };
      out.set(lpId, i);
    }
    return i;
  };

  const finalised = history.closings.filter((c) => c.finalised).sort(byDate);
  if (finalised.length) {
    for (const c of finalised) {
      // A later closing's commitment carries the fee from the day after its
      // catch-up fee stops: before that, the catch-up fee charged it.
      const covered = c.result?.totals.feeCoveredThrough;
      const from = covered ? dayAfter(covered) : c.closingDate;
      for (const k of c.commitments) {
        const i = at(k.lpId, k.name);
        i.commitments.push({ from, amount: k.amount });
        if (k.feeRateOverride && k.feeRateOverride > 0) i.feeRateOverride = k.feeRateOverride;
        if (k.feeExempt) i.feeExempt = true;
      }
    }
  } else {
    const last = [...history.calls].sort((a, b) => b.callDate.localeCompare(a.callDate))[0];
    for (const l of last?.lines ?? []) at(l.lpId, l.name).commitments.push({ from: '0001-01-01', amount: l.commitment });
  }

  // Invested capital: opening balances, then each call's deals, then each
  // equalization's share of them.
  const calls = [...history.calls].sort((a, b) => a.callDate.localeCompare(b.callDate));
  for (const l of calls[0]?.lines ?? []) {
    if (l.openInvested) at(l.lpId, l.name).invested!.push({ from: '0001-01-01', amount: l.openInvested });
  }
  const dealShare = new Map<number, number>();
  for (const c of calls) {
    const called = c.lines.reduce((s, l) => s + l.capital, 0);
    dealShare.set(c.callNo, called > 0 ? c.lines.reduce((s, l) => s + l.deal, 0) / called : 0);
    for (const l of c.lines) if (l.deal) at(l.lpId, l.name).invested!.push({ from: c.callDate, amount: l.deal });
  }
  for (const c of finalised) {
    for (const l of c.result?.lines ?? []) {
      const amount = l.calls.reduce((s, x) => s + x.capital * (dealShare.get(x.callNo) ?? 0), 0);
      if (amount) at(l.lpId, l.name).invested!.push({ from: c.closingDate, amount });
    }
  }

  return [...out.values()].sort((a, b) => a.lpId.localeCompare(b.lpId));
}

export interface FeePeriod {
  from: string;
  to: string;
  /** "Q3 2026"; the first period, if the fund started part-way through it, says so. */
  label: string;
  /** True when the fund started part-way through this period. */
  partial: boolean;
}

/**
 * The fund's fee periods, oldest first: from the day fees start — the first
 * close, or for a fund with no closings its first call — to the period that
 * contains `through`.
 *
 * Each period's length is read from the terms in force when it starts, so a
 * fund that moves from quarterly to half-yearly fees lists both.
 */
export function feePeriodsFor(history: FundHistory, through: string): FeePeriod[] {
  const finalised = history.closings.filter((c) => c.finalised).sort(byDate);
  const firstCall = [...history.calls].sort((a, b) => a.callDate.localeCompare(b.callDate))[0];
  const start = finalised[0]?.closingDate ?? firstCall?.callDate;
  if (!start || start > through) return [];

  const out: FeePeriod[] = [];
  for (let at = start; at <= through; ) {
    const months = periodMonths(termsOn(history.terms, at)?.feePeriodFraction ?? null);
    const p = periodContaining(at, months);
    const partial = at !== p.from;
    out.push({ from: at, to: p.to, label: periodLabel(p.from, months), partial });
    at = dayAfter(p.to);
  }
  return out;
}

/** The fee for a period, worked out from the record as it stands. */
export function feeRunFor(history: FundHistory, from: string, to: string): FeeResult {
  const decimals = termsOn(history.terms, from)?.roundingDecimals ?? 2;
  return feeForRange(from, to, history.terms, feeInvestorsFrom(history), decimals);
}

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
import { dayAfter, periodContaining, periodLabel, periodMonths } from './dates';
import { termsOn, type FundTerms } from './fund-terms';
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

  const priorCalls: PriorCall[] = history.calls
    .filter((call) => call.callDate < closing.closingDate)
    .map((call) => ({
      callNo: call.callNo,
      dueDate: call.dueDate,
      lines: call.lines.map((l) => ({ lpId: l.lpId, capital: l.capital, inside: l.inside })),
    }));

  return {
    closingDate: closing.closingDate,
    feeStart: first.closingDate,
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

/** Where every investor stands on `date`, from the record. */
export function positionsOn(history: FundHistory, date: string): Position[] {
  const hasClosings = history.closings.some((c) => c.finalised);
  return positionsAsOf(date, {
    calls: history.calls,
    equalizations: history.closings
      .filter((c) => c.finalised && c.result)
      .map((c) => ({
        closingDate: c.closingDate,
        lines: c.result!.lines,
        feeReducesUnfunded: termsOn(history.terms, c.closingDate)?.feeReducesUnfunded ?? true,
      })),
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
      for (const k of c.commitments) {
        const i = at(k.lpId, k.name);
        i.commitments.push({ from: c.closingDate, amount: k.amount });
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

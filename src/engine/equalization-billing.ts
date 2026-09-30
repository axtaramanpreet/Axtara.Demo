/**
 * Settling a later closing's equalization on a capital call.
 *
 * A finalised later closing fixes what each late investor pays and each
 * earlier investor gets back (`EqualizationResult.lines[].net`). Settled on
 * the next call, the balances move on that call too: until it, the late
 * investor has paid nothing and all their commitment is unfunded
 * (`settles: 'on_call'`; schedules saved before that rule moved them on the
 * closing date). A closing settled on the next call is carried by the first
 * call sent after it:
 *
 *   still owed = the closing's net, per investor − what sent calls settled
 *
 * The capital interest runs from each earlier call's due date to the closing
 * date, or — when the terms say so, the fund manager's rule — to the payment
 * due date of the call that collects it: worked out again from the frozen
 * capital shares, rate and basis (`equalizationRunTo`), never by
 * equalizing again. Once a sent call has carried a closing, what it charged is
 * what was charged.
 *
 * The next call settles all of it: a late investor's amount is added to their
 * call, and an earlier investor's credit comes off theirs. A credit larger than
 * their call is not held back for later calls — the notice shows the rest as
 * paid to them, so they are made whole when the late investors pay in.
 */

import { fmt, round } from './format';
import type { ComputedRow, EqualizationDueEntry, EqualizationParts } from './types';
import type { FundHistory, Settlement } from './fund-history';
import { termsOn } from './fund-terms';
import { addBusinessDays } from './dates';
import type { EqualizationResult } from './equalization';
import { equalizationRunTo } from './equalization';

export interface ClosingOwed {
  closingId: string;
  closingNo: number;
  closingDate: string;
  /** Still to settle per investor: + to pay, − to credit. Zeros left out. */
  owed: Record<string, number>;
  /** The same, in its parts, for the investors in `owed`. */
  parts: Record<string, EqualizationParts>;
  /** The date the capital interest runs to. */
  interestUntil: string;
  /** The interest runs to the collecting call's payment due date. */
  interestToDueDate: boolean;
  /** Whether the catch-up fee counts against commitment, by the terms on the closing date. */
  feeReducesUnfunded: boolean;
  /** Sent calls that settled part of it, and how much each, net. */
  settledOn: { callNo: number; amount: number }[];
}

const PARTS = ['capital', 'inside', 'interest', 'catchUpFee', 'feeInterest'] as const;
/** What an investor pays or is credited: every part but `inside`, which is inside `capital`. */
const netOf = (p: EqualizationParts) => p.capital + p.interest + p.catchUpFee + (p.feeInterest ?? 0);

/**
 * What each later closing settled on the next call still owes, as at a call
 * dated `on`. Only closings on or before that date, finalised, with an
 * equalization, and chosen to be settled on a call. `excludeCallNo` leaves a
 * call's own schedule out, so a draft does not count what it itself carries.
 * `dueDate` is the collecting call's payment due date; blank, interest that
 * runs to it stops at the closing date until it is set (and the call is not
 * approved without it).
 */
export function equalizationOwed(
  history: FundHistory,
  on: string,
  options: { excludeCallNo?: number; dueDate?: string | null } = {},
): ClosingOwed[] {
  const { excludeCallNo, dueDate } = options;
  const out: ClosingOwed[] = [];
  const closings = [...history.closings].sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.closingNo - b.closingNo);
  for (const c of closings) {
    if (!c.finalised || !c.result || c.settlement !== 'next_call' || c.closingDate > on) continue;
    const closingTerms = termsOn(history.terms, c.closingDate);
    const d = closingTerms?.roundingDecimals ?? 2;
    const carriers = history.calls
      .filter((call) => call.callNo !== excludeCallNo)
      .flatMap((call) => {
        const entry = call.equalizationSchedule?.find((e) => e.closingId === c.id);
        return entry ? [{ callNo: call.callNo, entry }] : [];
      });

    // Where the capital interest stops. A closing finalised before this was
    // recorded keeps interest to its closing date; once a sent call carried
    // it, the interest it charged is the interest.
    const toDue = interestRunsToDueDate(c.result);
    const until = toDue && !carriers.length && dueDate && dueDate > c.closingDate ? dueDate : c.closingDate;
    const dated = equalizationRunTo(c.result, until);

    const parts: Record<string, EqualizationParts> = {};
    for (const l of dated.lines) {
      parts[l.lpId] = {
        capital: l.capital,
        inside: l.inside,
        interest: l.interest,
        catchUpFee: l.catchUpFee,
        feeInterest: l.feeInterest ?? 0,
      };
    }
    // Run to its own due date, what a sent call charged as interest is the
    // interest: nothing more of it is owed.
    if (toDue && carriers.length) {
      for (const [lpId, p] of Object.entries(parts)) {
        p.interest = carriers.reduce((t, k) => t + (k.entry.parts[lpId]?.interest ?? 0), 0);
      }
    }
    const settledOn: ClosingOwed['settledOn'] = [];
    for (const { callNo, entry } of carriers) {
      let amount = 0;
      for (const [lpId, x] of Object.entries(entry.parts)) {
        const p = (parts[lpId] ??= { capital: 0, inside: 0, interest: 0, catchUpFee: 0, feeInterest: 0 });
        for (const k of PARTS) p[k] = (p[k] ?? 0) - (x[k] ?? 0);
        amount += netOf(x);
      }
      settledOn.push({ callNo, amount: round(amount, d) });
    }
    const owed: Record<string, number> = {};
    for (const [lpId, p] of Object.entries(parts)) {
      for (const k of PARTS) p[k] = round(p[k] ?? 0, d);
      const net = round(netOf(p), d);
      if (net === 0 && PARTS.every((k) => !p[k])) delete parts[lpId];
      else owed[lpId] = net;
    }
    out.push({
      closingId: c.id,
      closingNo: c.closingNo,
      closingDate: c.closingDate,
      owed,
      parts,
      settledOn,
      interestUntil: until,
      interestToDueDate: toDue && !carriers.length,
      feeReducesUnfunded: closingTerms?.feeReducesUnfunded ?? true,
    });
  }
  return out;
}

/** What a call settles: everything each later closing still owes, oldest closing first. */
export function buildEqualizationSchedule(owed: ClosingOwed[]): EqualizationDueEntry[] {
  return owed
    .filter((c) => Object.keys(c.owed).length)
    .map((c) => ({
      closingId: c.closingId,
      closingNo: c.closingNo,
      closingDate: c.closingDate,
      byLp: { ...c.owed },
      parts: Object.fromEntries(Object.entries(c.parts).map(([id, p]) => [id, { ...p }])),
      interestUntil: c.interestUntil,
      ...(c.interestToDueDate && { interestToDueDate: true }),
      settles: 'on_call' as const,
      feeReducesUnfunded: c.feeReducesUnfunded,
    }));
}

/** Where a call's stored equalization differs from what the record says it should settle. */
export function equalizationScheduleDifferences(stored: EqualizationDueEntry[], fresh: EqualizationDueEntry[]): string[] {
  const out: string[] = [];
  const key = (e: EqualizationDueEntry) => e.closingId;
  const byKey = new Map(stored.map((e) => [key(e), e]));
  for (const f of fresh) {
    const s = byKey.get(key(f));
    byKey.delete(key(f));
    if (!s) {
      out.push(`Closing ${f.closingNo}'s equalization is not on this call.`);
      continue;
    }
    const ids = new Set([...Object.keys(f.byLp), ...Object.keys(s.byLp)]);
    for (const id of ids) {
      const a = s.byLp[id] ?? 0;
      const b = f.byLp[id] ?? 0;
      if (Math.abs(a - b) > 0.005) {
        out.push(`Closing ${f.closingNo}: ${id} is ${fmt(a)} on this call; the record says ${fmt(b)}.`);
        continue;
      }
      // The same total can hide parts put in the wrong place — capital as fee.
      const [ps, pf] = [s.parts?.[id], f.parts[id]];
      const same = (x?: EqualizationParts, y?: EqualizationParts) =>
        PARTS.every((k) => Math.abs((x?.[k] ?? 0) - (y?.[k] ?? 0)) <= 0.005);
      if (!same(ps, pf)) out.push(`Closing ${f.closingNo}: ${id}'s capital, interest and catch-up fee on this call differ from the record.`);
    }
    if (s.settles !== f.settles || (s.feeReducesUnfunded ?? true) !== (f.feeReducesUnfunded ?? true)) {
      out.push(`Closing ${f.closingNo}'s equalization on this call was worked out under an older rule. Open Setup to bring it up to date.`);
    }
    if ((s.interestUntil ?? s.closingDate) !== (f.interestUntil ?? f.closingDate)) {
      out.push(`Closing ${f.closingNo}: interest on this call runs to ${s.interestUntil ?? s.closingDate}; the record says ${f.interestUntil ?? f.closingDate}.`);
    }
  }
  for (const s of byKey.values()) out.push(`Closing ${s.closingNo}'s equalization is on this call, but nothing of it is owed.`);
  return out;
}

/**
 * An investor's equalization on a call, in its parts, every closing it settles
 * added together: + to pay, − credited.
 */
export function equalizationPartsOf(schedule: EqualizationDueEntry[] | null | undefined, lpId: string, decimals = 2): Required<EqualizationParts> {
  const sum = (k: keyof EqualizationParts) => round((schedule ?? []).reduce((t, e) => t + (e.parts[lpId]?.[k] ?? 0), 0), decimals);
  return { capital: sum('capital'), inside: sum('inside'), interest: sum('interest'), catchUpFee: sum('catchUpFee'), feeInterest: sum('feeInterest') };
}

/** An investor's equalization net of its parts: what they pay (+) or are credited (−). */
export function equalizationNetOf(p: EqualizationParts): number {
  return netOf(p);
}

/**
 * The amount an investor is asked to wire on a call: what it draws, plus any
 * equalization it settles. Below nothing, the fund pays them the difference.
 */
export function amountDue(row: Pick<ComputedRow, 'total' | 'equalization'>, decimals = 2): number {
  return round(row.total + (row.equalization ?? 0), decimals);
}

/**
 * Later closings whose equalization nobody has said how to settle, as at a
 * call dated `on`. Money is owed and no document will ask for it, so a call
 * after one is not approved until the choice is made.
 */
export function unsettledClosings(history: FundHistory, on: string): { closingNo: number; closingDate: string }[] {
  return history.closings
    .filter((c) => c.finalised && c.result && !c.settlement && c.closingDate <= on && c.result.lines.some((l) => l.net !== 0))
    .map((c) => ({ closingNo: c.closingNo, closingDate: c.closingDate }));
}

/**
 * Whether a finalised equalization's capital interest runs to the date the
 * late investor pays — the call or statement's due date — rather than the
 * closing. Only when there is interest to run: a closing with no earlier
 * calls, or no rate, has none, and needs no due date for it.
 */
export function interestRunsToDueDate(result: EqualizationResult): boolean {
  return result.totals.interestUntil === 'collection_due_date' && !!result.totals.interestRate && result.lines.some((l) => l.capital !== 0);
}

/** Working days a statement gives investors to pay, as suggested; the person approving picks the date. */
export const STATEMENT_DAYS_TO_PAY = 10;

/** The payment due date suggested for a closing's statements: ten working days after the closing. */
export function suggestedStatementDueDate(closingDate: string): string {
  return addBusinessDays(closingDate, STATEMENT_DAYS_TO_PAY);
}

/**
 * A closing's equalization as its statements ask for it: with interest to the
 * statement's payment due date when the terms run it to then, otherwise as
 * finalised.
 */
export function equalizationForStatement(result: EqualizationResult, dueDate: string): EqualizationResult {
  return interestRunsToDueDate(result) ? equalizationRunTo(result, dueDate) : result;
}

/**
 * Why a finalised closing cannot be settled this way, or null when it can.
 *
 * Settled on the next call, a closing's balances move on that call. A later
 * closing refunds everyone by what they hold of each earlier call — the
 * waiting closing's late investors included. Settled now, it would move their
 * balances first: refunding capital they have not paid yet, below nothing. So
 * a closing is not settled now while an earlier one waits for its call, and a
 * closing is not made to wait while a later one was settled now.
 * `carried` says whether a sent call carried a closing.
 */
export function settlementConflict(
  closings: { id: string; closingNo: number; closingDate: string; finalised: boolean; settlement?: Settlement | null }[],
  carried: (closingId: string) => boolean,
  closingId: string,
  settlement: Settlement,
): string | null {
  const self = closings.find((c) => c.id === closingId);
  if (!self) return null;
  const waiting = (c: (typeof closings)[number]) => c.finalised && c.settlement === 'next_call' && !carried(c.id);
  if (settlement === 'on_closing') {
    const earlier = closings.filter((c) => c.id !== closingId && c.closingDate < self.closingDate && waiting(c));
    if (earlier.length) {
      const names = earlier.map((c) => `Closing ${c.closingNo}`).join(', ');
      return `${names}'s equalization waits for the next capital call, so this one goes on that call too: settled now, it would refund its investors capital they have not paid yet.`;
    }
  }
  if (settlement === 'next_call' && !carried(closingId)) {
    const later = closings.filter((c) => c.id !== closingId && c.closingDate > self.closingDate && c.finalised && c.settlement === 'on_closing');
    if (later.length) {
      const names = later.map((c) => `Closing ${c.closingNo}`).join(', ');
      return `${names}, after this one, was settled now and refunds this closing's investors on its date; this one has to be settled now too.`;
    }
  }
  return null;
}

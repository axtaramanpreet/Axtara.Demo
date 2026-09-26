/**
 * Settling a later closing's equalization on a capital call.
 *
 * A finalised later closing fixes what each late investor pays and each
 * earlier investor gets back (`EqualizationResult.lines[].net`). Balances move
 * on the closing date whichever way it is settled; settling is only about the
 * cash. A closing settled on the next call is carried by the first call sent
 * after it:
 *
 *   still owed = the closing's net, per investor − what sent calls settled
 *
 * The next call settles all of it: a late investor's amount is added to their
 * call, and an earlier investor's credit comes off theirs. A credit larger than
 * their call is not held back for later calls — the notice shows the rest as
 * paid to them, so they are made whole when the late investors pay in.
 */

import { fmt, round } from './format';
import type { ComputedRow, EqualizationDueEntry, EqualizationParts } from './types';
import type { FundHistory } from './fund-history';
import { termsOn } from './fund-terms';

export interface ClosingOwed {
  closingId: string;
  closingNo: number;
  closingDate: string;
  /** Still to settle per investor: + to pay, − to credit. Zeros left out. */
  owed: Record<string, number>;
  /** The same, in its three parts, for the investors in `owed`. */
  parts: Record<string, EqualizationParts>;
  /** Sent calls that settled part of it, and how much each, net. */
  settledOn: { callNo: number; amount: number }[];
}

/**
 * What each later closing settled on the next call still owes, as at a call
 * dated `on`. Only closings on or before that date, finalised, with an
 * equalization, and chosen to be settled on a call. `excludeCallNo` leaves a
 * call's own schedule out, so a draft does not count what it itself carries.
 */
export function equalizationOwed(history: FundHistory, on: string, excludeCallNo?: number): ClosingOwed[] {
  const out: ClosingOwed[] = [];
  const closings = [...history.closings].sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.closingNo - b.closingNo);
  for (const c of closings) {
    if (!c.finalised || !c.result || c.settlement !== 'next_call' || c.closingDate > on) continue;
    const d = termsOn(history.terms, c.closingDate)?.roundingDecimals ?? 2;
    const parts: Record<string, EqualizationParts> = {};
    for (const l of c.result.lines) parts[l.lpId] = { capital: l.capital, interest: l.interest, catchUpFee: l.catchUpFee };
    const settledOn: ClosingOwed['settledOn'] = [];
    for (const call of history.calls) {
      if (call.callNo === excludeCallNo) continue;
      const entry = call.equalizationSchedule?.find((e) => e.closingId === c.id);
      if (!entry) continue;
      let amount = 0;
      for (const [lpId, x] of Object.entries(entry.parts)) {
        const p = (parts[lpId] ??= { capital: 0, interest: 0, catchUpFee: 0 });
        p.capital -= x.capital;
        p.interest -= x.interest;
        p.catchUpFee -= x.catchUpFee;
        amount += x.capital + x.interest + x.catchUpFee;
      }
      settledOn.push({ callNo: call.callNo, amount: round(amount, d) });
    }
    const owed: Record<string, number> = {};
    for (const [lpId, p] of Object.entries(parts)) {
      p.capital = round(p.capital, d);
      p.interest = round(p.interest, d);
      p.catchUpFee = round(p.catchUpFee, d);
      const net = round(p.capital + p.interest + p.catchUpFee, d);
      if (net === 0 && !p.capital && !p.interest && !p.catchUpFee) delete parts[lpId];
      else owed[lpId] = net;
    }
    out.push({ closingId: c.id, closingNo: c.closingNo, closingDate: c.closingDate, owed, parts, settledOn });
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
        (['capital', 'interest', 'catchUpFee'] as const).every((k) => Math.abs((x?.[k] ?? 0) - (y?.[k] ?? 0)) <= 0.005);
      if (!same(ps, pf)) out.push(`Closing ${f.closingNo}: ${id}'s capital, interest and catch-up fee on this call differ from the record.`);
    }
  }
  for (const s of byKey.values()) out.push(`Closing ${s.closingNo}'s equalization is on this call, but nothing of it is owed.`);
  return out;
}

/**
 * An investor's equalization on a call, in its three parts, every closing it
 * settles added together: + to pay, − credited.
 */
export function equalizationPartsOf(schedule: EqualizationDueEntry[] | null | undefined, lpId: string, decimals = 2): EqualizationParts {
  const sum = (k: keyof EqualizationParts) => round((schedule ?? []).reduce((t, e) => t + (e.parts[lpId]?.[k] ?? 0), 0), decimals);
  return { capital: sum('capital'), interest: sum('interest'), catchUpFee: sum('catchUpFee') };
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

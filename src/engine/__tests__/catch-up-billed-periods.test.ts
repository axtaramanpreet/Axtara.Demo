/**
 * The catch-up fee covers the fee periods already billed to the investors in
 * before — the default — so every later period bills the late investor in full,
 * with everyone else.
 *
 * First close 1 Jan 2026: LP01 6m, LP02 4m. 2% on commitment, quarterly; 8%
 * simple late-close interest; the catch-up fee to the GP, interest on it from
 * the first close. LP07, 5m, joins at a second close on 1 May.
 *
 * A quarter's fee on 5m: 5,000,000 × 2% × 0.25 = 25,000.
 *
 *   Q1 billed on 15 Jan, before LP07 joins:
 *     catch-up = Q1 = 25,000; interest 25,000 × 8% × 120/365 (1 Jan → 1 May) = 657.53
 *     Q2 bills LP07 in full: 25,000, like LP01 30,000 and LP02 20,000
 *   Q1 and Q2 billed (Q2 on 2 Apr, in advance), before LP07 joins:
 *     catch-up = Q1 + Q2 = 50,000; interest 50,000 × 8% × 120/365 = 1,315.07
 *     Q2 bills LP07 nothing more; Q3 in full
 *   Nothing billed before LP07 joins: no catch-up; Q1 bills LP07 in full
 *   'closing_date' instead: catch-up to 30 Apr = 25,000 + 25,000 × 30/91 = 33,241.76,
 *     and Q2 bills LP07 from 1 May: 25,000 × 61/91 = 16,758.24
 */

import { describe, expect, it } from 'vitest';
import { equalize } from '../equalization';
import { buildFeeSchedule, feeLedgerFor, feeOwed } from '../fee-billing';
import { catchUpFeeThrough, equalizationInputFor, type ClosingRecord, type FundHistory } from '../fund-history';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import type { IssuedCall } from '../positions';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  feeTiming: 'advance',
  feeReducesUnfunded: true,
  lateCloseInterestRate: 0.08,
  lateCloseInterestBasis: 'simple',
  catchUpFeeTo: 'gp',
};
const k = (lpId: string, amount: number) => ({ lpId, name: lpId, amount, feeRateOverride: null, feeExempt: false });
const first: ClosingRecord = { id: 'k1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null, commitments: [k('LP01', 6e6), k('LP02', 4e6)] };
const second: ClosingRecord = { id: 'k2', closingNo: 2, closingDate: '2026-05-01', finalised: false, result: null, commitments: [k('LP07', 5e6)] };

/** A sent call that billed these periods, as the record owed them on its date. */
const billing = (callNo: number, callDate: string, labels: string[], history: FundHistory): IssuedCall => {
  const owed = feeOwed(history, callDate, callNo);
  return {
    callNo, callDate, dueDate: callDate, lines: [],
    feeSchedule: buildFeeSchedule(owed, owed.filter((o) => labels.includes(o.period.label)).map((o) => o.period)),
  };
};
/** The fund after LP07's closing is finalised, with the calls sent before it. */
const closed = (t: FundTerms, callsBefore: (h: FundHistory) => IssuedCall[]): FundHistory => {
  const base: FundHistory = { terms: [t], closings: [first, second], calls: [] };
  const calls = callsBefore(base);
  const draft = { ...base, calls };
  const result = equalize(equalizationInputFor(draft, 'k2')!);
  return { ...draft, closings: [first, { ...second, finalised: true, result, settlement: 'next_call' }] };
};
const lp07 = (h: FundHistory) => h.closings[1].result!.lines.find((l) => l.lpId === 'LP07')!;
const owedFor = (h: FundHistory, label: string) => feeOwed(h, '2026-09-20').find((o) => o.period.label === label)!.owed;

describe('Q1 billed before the late investor joins', () => {
  const h = closed(terms, (b) => [billing(1, '2026-01-15', ['Q1 2026'], b)]);

  it('covers Q1 only', () => {
    expect(catchUpFeeThrough(h, second)).toBe('2026-03-31');
    expect(lp07(h).catchUpFee).toBe(25_000);
    expect(lp07(h).feeSlices.map((s) => [s.from, s.to])).toEqual([['2026-01-01', '2026-03-31']]);
    expect(h.closings[1].result!.totals.feeCoveredThrough).toBe('2026-03-31');
  });

  it('charges interest on it from the first close to the closing', () => {
    expect(lp07(h).feeInterest).toBe(657.53);
  });

  it('bills Q2 to the late investor in full, like everyone else', () => {
    expect(owedFor(h, 'Q2 2026')).toEqual({ LP01: 30_000, LP02: 20_000, LP07: 25_000 });
  });

  it('asks nothing more for Q1: it was billed, and the catch-up covered the late investor', () => {
    expect(owedFor(h, 'Q1 2026')).toEqual({});
    expect(feeLedgerFor(h, '2026-09-20').find((e) => e.period.label === 'Q1 2026')!.status).toBe('billed');
  });
});

describe('a quarter billed in advance before the late investor joins', () => {
  const h = closed(terms, (b) => {
    const c1 = billing(1, '2026-01-15', ['Q1 2026'], b);
    return [c1, billing(2, '2026-04-02', ['Q2 2026'], { ...b, calls: [c1] })];
  });

  it('is covered whole, past the closing date', () => {
    expect(catchUpFeeThrough(h, second)).toBe('2026-06-30');
    expect(lp07(h).catchUpFee).toBe(50_000);
    expect(lp07(h).feeInterest).toBe(1_315.07);
  });

  it('so it bills the late investor nothing more, and the next quarter in full', () => {
    expect(owedFor(h, 'Q2 2026')).toEqual({});
    expect(owedFor(h, 'Q3 2026')).toEqual({ LP01: 30_000, LP02: 20_000, LP07: 25_000 });
  });
});

describe('nothing billed before the late investor joins', () => {
  const h = closed(terms, () => []);

  it('has no catch-up, and says why', () => {
    expect(lp07(h).catchUpFee).toBe(0);
    expect(h.closings[1].result!.checks.map((c) => c.text)).toContain(
      'No catch-up management fee: no fee period had been billed before this closing, so the late investors are billed every period in full with everyone else.',
    );
  });

  it('bills every period in full, Q1 included', () => {
    expect(owedFor(h, 'Q1 2026')).toEqual({ LP01: 30_000, LP02: 20_000, LP07: 25_000 });
  });
});

describe('with the catch-up to the closing date instead', () => {
  const h = closed({ ...terms, catchUpFeeUntil: 'closing_date' }, (b) => [billing(1, '2026-01-15', ['Q1 2026'], b)]);

  it('covers every day up to the closing, and Q2 from the day they joined', () => {
    expect(catchUpFeeThrough(h, second)).toBe('2026-04-30');
    expect(lp07(h).catchUpFee).toBe(33_241.76);
    expect(owedFor(h, 'Q2 2026').LP07).toBe(16_758.24);
  });
});

describe('a closing finalised before the rule', () => {
  it('keeps its fee from the closing date', () => {
    const h = closed(terms, (b) => [billing(1, '2026-01-15', ['Q1 2026'], b)]);
    const older = structuredClone(h);
    delete older.closings[1].result!.totals.feeCoveredThrough;
    // Its catch-up stopped at Q1 here, but without the date recorded Q2 counts LP07 from 1 May.
    expect(owedFor(older, 'Q2 2026').LP07).toBe(16_758.24);
  });
});

/**
 * A third closing refunds everyone who holds a share of the earlier calls —
 * including an investor admitted at the second closing, who took their share
 * of those calls through its equalization.
 *
 * First close 1 Jan 2026: FA01 10m, FA02 20m. Call 1 (due 29 Jan): 3,000,000,
 * all against commitment — FA01 1,000,000, FA02 2,000,000. No fee; 8% simple
 * late-close interest to the investors already in.
 *
 * Second close 1 May: FA03 15m. Moved 3,000,000 × 15/45 = 1,000,000: FA03 pays
 * it, FA01 gets 333,333.33 back, FA02 666,666.67. After it, of call 1:
 *   FA01 666,666.67   FA02 1,333,333.33   FA03 1,000,000
 *
 * Third close 1 Jul: FA04 5m. Moved 3,000,000 × 5/50 = 300,000, refunded by
 * what each holds of call 1:
 *   FA01 300,000 × 666,666.67/3,000,000 = 66,666.67   FA03 100,000
 *   FA02 (the largest, takes the rest) 300,000 − 166,666.67 = 133,333.33
 * Interest, 29 Jan → 1 Jul, 153 days: 300,000 × 8% × 153/365 = 10,060.27,
 * shared the same way: FA01 2,235.62, FA03 3,353.42, FA02 4,471.23.
 * Afterwards every investor has paid in 6% of commitment.
 */

import { describe, expect, it } from 'vitest';
import { equalize } from '../equalization';
import { settlementConflict } from '../equalization-billing';
import { equalizationInputFor, positionsOn, type ClosingRecord, type FundHistory } from '../fund-history';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import type { IssuedCall } from '../positions';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '',
  lateCloseInterestRate: 0.08,
  lateCloseInterestBasis: 'simple',
  equalizationInterestTo: 'existing_lps',
  equalizationInterestUntil: 'closing_date',
};
const line = (lpId: string, commitment: number, capital: number) => ({
  lpId, name: lpId, commitment, openPaid: 0, openUnfunded: commitment, openInvested: 0, total: capital, reduces: capital, capital, inside: capital, deal: capital,
});
const call1: IssuedCall = { callNo: 1, callDate: '2026-01-15', dueDate: '2026-01-29', lines: [line('FA01', 10e6, 1_000_000), line('FA02', 20e6, 2_000_000)] };
const k = (lpId: string, amount: number) => ({ lpId, name: lpId, amount, feeRateOverride: null, feeExempt: false });
const close1: ClosingRecord = { id: 'k1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null, commitments: [k('FA01', 10e6), k('FA02', 20e6)] };
const close2: ClosingRecord = { id: 'k2', closingNo: 2, closingDate: '2026-05-01', finalised: false, result: null, commitments: [k('FA03', 15e6)] };
const close3: ClosingRecord = { id: 'k3', closingNo: 3, closingDate: '2026-07-01', finalised: false, result: null, commitments: [k('FA04', 5e6)] };

const r2 = equalize(equalizationInputFor({ terms: [terms], closings: [close1, close2], calls: [call1] }, 'k2')!);
const afterTwo: FundHistory = { terms: [terms], closings: [close1, { ...close2, finalised: true, result: r2, settlement: 'on_closing' }, close3], calls: [call1] };
const r3 = equalize(equalizationInputFor(afterTwo, 'k3')!);
const of = (id: string) => r3.lines.find((l) => l.lpId === id)!;

describe('a third closing', () => {
  it('counts what each investor holds of an earlier call, the second close’s investor included', () => {
    const [c] = equalizationInputFor(afterTwo, 'k3')!.priorCalls;
    expect(Object.fromEntries(c.lines.map((l) => [l.lpId, l.capital]))).toEqual({ FA01: 666_666.67, FA02: 1_333_333.33, FA03: 1_000_000 });
  });

  it('refunds by that, not by who paid on the day', () => {
    expect(of('FA04').capital).toBe(300_000);
    expect([of('FA01').capital, of('FA02').capital, of('FA03').capital]).toEqual([-66_666.67, -133_333.33, -100_000]);
  });

  it('shares the interest the same way', () => {
    expect(of('FA04').interest).toBe(10_060.27);
    expect([of('FA01').interest, of('FA02').interest, of('FA03').interest]).toEqual([-2_235.62, -4_471.23, -3_353.42]);
  });

  it('leaves every investor at the same share of commitment paid in', () => {
    const history: FundHistory = { ...afterTwo, closings: [...afterTwo.closings.slice(0, 2), { ...close3, finalised: true, result: r3, settlement: 'on_closing' }] };
    const p = positionsOn(history, '2026-07-02');
    // 3,000,000 of 50,000,000 = 6%: FA01 600,000, FA02 1,200,000, FA03 900,000, FA04 300,000
    expect(Object.fromEntries(p.map((x) => [x.lpId, x.paidIn]))).toEqual({ FA01: 600_000, FA02: 1_200_000, FA03: 900_000, FA04: 300_000 });
  });
});

describe('a third closing while the second still waits for its call', () => {
  // Settled now, closing 3 would refund FA03 100,000 of call 1 that FA03 has not
  // paid yet: paid-in −100,000, unfunded above commitment. So it is not allowed.
  const pending = [
    { ...close1 },
    { ...close2, finalised: true, settlement: 'next_call' as const },
    { ...close3, finalised: true, settlement: null },
  ];
  const none = () => false;

  it('cannot be settled now', () => {
    expect(settlementConflict(pending, none, 'k3', 'on_closing')).toMatch(/^Closing 2's equalization waits for the next capital call/);
  });

  it('can go on the next call with it', () => {
    expect(settlementConflict(pending, none, 'k3', 'next_call')).toBeNull();
  });

  it('can be settled now once the call that carried closing 2 is sent', () => {
    expect(settlementConflict(pending, (id) => id === 'k2', 'k3', 'on_closing')).toBeNull();
  });

  it('and closing 2 cannot be made to wait once closing 3 was settled now', () => {
    const later = [pending[0], { ...pending[1], settlement: 'on_closing' as const }, { ...pending[2], settlement: 'on_closing' as const }];
    expect(settlementConflict(later, none, 'k2', 'next_call')).toMatch(/^Closing 3, after this one, was settled now/);
    expect(settlementConflict(later, none, 'k2', 'on_closing')).toBeNull();
  });
});

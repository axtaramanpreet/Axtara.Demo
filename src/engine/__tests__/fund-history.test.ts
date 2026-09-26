/**
 * Reading a fund's history the same way every time.
 */

import { describe, expect, it } from 'vitest';
import { equalize } from '../equalization';
import { feeForRange } from '../fee-run';
import {
  commitmentsFrom,
  equalizationInputFor,
  feeInvestorsFrom,
  feePeriodsFor,
  feeRunFor,
  positionsOn,
  type ClosingRecord,
  type FundHistory,
} from '../fund-history';
import { feeLedgerFor, termsEditImpact } from '../fee-billing';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import type { IssuedCall } from '../positions';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  feeReducesUnfunded: true,
  lateCloseInterestRate: 0.08,
};

const first: ClosingRecord = {
  id: 'c1',
  closingNo: 1,
  closingDate: '2026-01-01',
  finalised: true,
  commitments: [
    { lpId: 'LP01', name: 'Alpha', amount: 6e6, feeRateOverride: null, feeExempt: false },
    { lpId: 'LP02', name: 'Beta', amount: 4e6, feeRateOverride: 0.01, feeExempt: false },
  ],
  result: null,
};
const second: ClosingRecord = {
  id: 'c2',
  closingNo: 2,
  closingDate: '2026-08-01',
  finalised: false,
  commitments: [{ lpId: 'LP07', name: 'Eta', amount: 5e6, feeRateOverride: null, feeExempt: false }],
  result: null,
};

const line = (lpId: string, commitment: number, capital: number, inside: number, deal: number) => ({
  lpId, name: lpId, commitment, openPaid: 0, openUnfunded: commitment, openInvested: 0,
  total: capital, reduces: inside, capital, inside, deal,
});
const call1: IssuedCall = { callNo: 1, callDate: '2026-02-01', dueDate: '2026-02-15', lines: [line('LP01', 6e6, 600_000, 600_000, 600_000), line('LP02', 4e6, 400_000, 400_000, 400_000)] };
// Issued after the second close: must not be equalized.
const call3: IssuedCall = { callNo: 3, callDate: '2026-09-01', dueDate: '2026-09-15', lines: [line('LP01', 6e6, 1, 1, 0)] };

const history: FundHistory = { terms: [terms], closings: [first, second], calls: [call1, call3] };

describe('which commitments count', () => {
  it('counts only finalised closings', () => {
    expect(Object.keys(commitmentsFrom(history))).toEqual(['LP01', 'LP02']);
  });

  it('includes a draft only when previewing that draft', () => {
    expect(commitmentsFrom(history, 'c2').LP07.changes).toEqual([{ from: '2026-08-01', amount: 5e6 }]);
  });
});

describe('what a closing is equalized against', () => {
  it('has nothing to equalize at the first close', () => {
    expect(equalizationInputFor(history, 'c1')).toBeNull();
  });

  it('is the investors already in, the new ones, and the calls made before it', () => {
    const input = equalizationInputFor(history, 'c2')!;
    expect(input.feeStart).toBe('2026-01-01');
    expect(input.existing.map((e) => [e.lpId, e.commitment])).toEqual([
      ['LP01', 6e6],
      ['LP02', 4e6],
    ]);
    expect(input.newcomers.map((n) => [n.lpId, n.commitment])).toEqual([['LP07', 5e6]]);
    // Call 3 was issued after the close: it is the new register's, not history to equalize.
    expect(input.priorCalls.map((c) => c.callNo)).toEqual([1]);
  });
});

describe('what a fee run sees', () => {
  it('dates each commitment from the closing that admitted it, with its side letter', () => {
    const investors = feeInvestorsFrom({ ...history, closings: [first, { ...second, finalised: true }] });
    expect(investors.find((i) => i.lpId === 'LP07')!.commitments).toEqual([{ from: '2026-08-01', amount: 5e6 }]);
    expect(investors.find((i) => i.lpId === 'LP02')!.feeRateOverride).toBe(0.01);
  });

  it('charges a late investor only from their close', () => {
    // Q3 2026: LP07 in from 1 August, 61 of 92 days: 5,000,000 × 0.02 × 0.25 × 61/92 = 16,576.09
    const investors = feeInvestorsFrom({ ...history, closings: [first, { ...second, finalised: true }] });
    const run = feeForRange('2026-07-01', '2026-09-30', history.terms, investors);
    expect(run.lines.find((l) => l.lpId === 'LP07')!.fee).toBe(16_576.09);
    // LP02's side letter: 4,000,000 × 0.01 × 0.25 = 10,000
    expect(run.lines.find((l) => l.lpId === 'LP02')!.fee).toBe(10_000);
  });

  it('reads a fund with no closings from its latest call', () => {
    const investors = feeInvestorsFrom({ ...history, closings: [] });
    expect(investors.find((i) => i.lpId === 'LP01')!.commitments).toEqual([{ from: '0001-01-01', amount: 6e6 }]);
  });
});

describe('where investors stand', () => {
  it('ignores a draft closing until it is finalised', () => {
    expect(positionsOn(history, '2026-08-15').map((p) => p.lpId)).toEqual(['LP01', 'LP02']);
  });

  it('includes the late investor, equalized, once it is', () => {
    const input = equalizationInputFor(history, 'c2')!;
    const done: ClosingRecord = { ...second, finalised: true, result: equalize(input) };
    const positions = positionsOn({ ...history, closings: [first, done] }, '2026-08-15');
    // 1,000,000 called before the close; LP07's share 1,000,000 × 5/15 = 333,333.33
    expect(positions.find((p) => p.lpId === 'LP07')).toMatchObject({ commitment: 5e6 });
    expect(positions.find((p) => p.lpId === 'LP07')!.paidIn).toBeCloseTo(333_333.33 + done.result!.lines.find((l) => l.lpId === 'LP07')!.catchUpFee, 2);
  });
});

describe('which fee periods a fund has', () => {
  it('runs from the first close to the period containing the date', () => {
    expect(feePeriodsFor(history, '2026-08-15').map((p) => [p.label, p.from, p.to])).toEqual([
      ['Q1 2026', '2026-01-01', '2026-03-31'],
      ['Q2 2026', '2026-04-01', '2026-06-30'],
      ['Q3 2026', '2026-07-01', '2026-09-30'],
    ]);
  });

  it('starts part-way through a period when the first close did', () => {
    const late = { ...history, closings: [{ ...first, closingDate: '2026-02-10' }] };
    expect(feePeriodsFor(late, '2026-04-01')[0]).toEqual({ from: '2026-02-10', to: '2026-03-31', label: 'Q1 2026', partial: true });
  });

  it('follows a change of period length in the terms', () => {
    const halfYearly: FundTerms = { ...terms, effectiveFrom: '2026-07-01', createdAt: '2026-06-01T00:00:00Z', feePeriodFraction: 0.5 };
    const periods = feePeriodsFor({ ...history, terms: [terms, halfYearly] }, '2027-02-01');
    expect(periods.map((p) => p.label)).toEqual(['Q1 2026', 'Q2 2026', 'H2 2026', 'H1 2027']);
  });

  it('has none before fees start, or for a fund with no record', () => {
    expect(feePeriodsFor(history, '2025-12-31')).toEqual([]);
    expect(feePeriodsFor({ terms: [terms], closings: [], calls: [] }, '2026-08-15')).toEqual([]);
  });
});

describe('the fee ledger', () => {
  // Q3 billed on a call before the second close admitted LP07 on 1 August.
  const billing = (callNo: number, h: FundHistory, from: string, to: string, label: string): IssuedCall => ({
    callNo, callDate: from, dueDate: from, lines: [],
    feeSchedule: [{ from, to, label, byLp: Object.fromEntries(feeRunFor(h, from, to).lines.map((l) => [l.lpId, l.fee])) }],
  });
  const q3Call = billing(4, history, '2026-07-01', '2026-09-30', 'Q3 2026');
  const afterClose: FundHistory = { ...history, closings: [first, { ...second, finalised: true }] };

  it('lists every period, and whether a call billed it', () => {
    const ledger = feeLedgerFor({ ...history, calls: [...history.calls, q3Call] }, '2026-08-15');
    expect(ledger.map((e) => [e.period.label, e.status])).toEqual([
      ['Q1 2026', 'not_billed'],
      ['Q2 2026', 'not_billed'],
      ['Q3 2026', 'billed'],
    ]);
    // Not billed: owed in full. Billed in full: nothing owed.
    expect(ledger[0].owedTotal).toBe(ledger[0].now.total);
    expect(ledger[2].owedTotal).toBe(0);
  });

  it('marks a billed period due a true-up once a later close changes it', () => {
    const q3 = feeLedgerFor({ ...afterClose, calls: [...history.calls, q3Call] }, '2026-08-15')[2];
    expect(q3.status).toBe('true_up_due');
    // LP07 was not billed; from 1 August they should have been: 16,576.09
    expect(q3.drift!.find((l) => l.lpId === 'LP07')).toMatchObject({ charged: 0, shouldHave: 16_576.09, trueUp: 16_576.09 });
    expect(q3.drift!.filter((l) => l.lpId !== 'LP07').every((l) => l.trueUp === 0)).toBe(true);
    expect(q3.owedTotal).toBe(16_576.09);
  });

  it('is billed again once a later call bills what is still owed', () => {
    const rest: IssuedCall = {
      callNo: 5, callDate: '2026-08-20', dueDate: '2026-08-20', lines: [],
      feeSchedule: [{ from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP07: 16_576.09 } }],
    };
    const q3 = feeLedgerFor({ ...afterClose, calls: [...history.calls, q3Call, rest] }, '2026-08-15')[2];
    expect(q3.status).toBe('billed');
    expect(q3.billedOn.map((b) => b.callNo)).toEqual([4, 5]);
  });
});

describe('what an edit to the terms would touch', () => {
  const finalHistory: FundHistory = { ...history, closings: [first, { ...second, finalised: true }] };
  // Q1 billed on Call No. 2.
  const q1Call: IssuedCall = {
    callNo: 2, callDate: '2026-03-01', dueDate: '2026-03-15', lines: [],
    feeSchedule: [{ from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026', byLp: Object.fromEntries(feeRunFor(finalHistory, '2026-01-01', '2026-03-31').lines.map((l) => [l.lpId, l.fee])) }],
  };
  const billedHistory: FundHistory = { ...finalHistory, calls: [call1, q1Call, call3] };

  it('lists the calls sent under the old terms, and the true-up each billed period would need', () => {
    // Correcting the fee from 2% to 1.75% from the start.
    const corrected = { ...terms, feeRateAnnual: 0.0175 };
    const impact = termsEditImpact(billedHistory, [corrected], '2026-09-30');
    expect([impact.from, impact.to]).toEqual(['2026-01-01', null]);
    expect(impact.issuedCalls.map((c) => c.callNo)).toEqual([1, 2, 3]);
    // Q1: LP01 6m at 2%→1.75% (−3,750); LP02 has a 1% side letter, unchanged.
    expect(impact.billedPeriods).toEqual([{ label: 'Q1 2026', from: '2026-01-01', to: '2026-03-31', billed: 40_000, becomes: 36_250, trueUp: -3_750 }]);
  });

  it('touches nothing before the date a change applies from', () => {
    const later = { ...terms, effectiveFrom: '2026-07-01', feeRateAnnual: 0.015 };
    const impact = termsEditImpact(billedHistory, [later], '2026-09-30');
    expect(impact.issuedCalls.map((c) => c.callNo)).toEqual([3]);
    expect(impact.billedPeriods).toEqual([]);
  });
});

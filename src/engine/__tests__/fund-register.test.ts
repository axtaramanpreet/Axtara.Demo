/**
 * The next call's register, read from the fund's record.
 *
 * The first test is the one that says the record is right: with no later
 * close, reading the register from the record must give exactly what carrying
 * it forward from the previous call gives. After a later close, only the
 * record has the late investor and the earlier investors' refunds.
 */

import { describe, expect, it } from 'vitest';
import { carryForwardRegister } from '../carry-forward';
import { compute } from '../compute';
import { equalizationInputFor, type ClosingRecord, type FundHistory } from '../fund-history';
import { equalize } from '../equalization';
import { fundRegister, positionFromRecord, registerDifferences, registerMismatches } from '../fund-register';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import { issuedCallFrom } from '../positions';
import { ILLUSTRATIVE_FUND } from '../fixtures/illustrative-fund';
import type { LPRow } from '../types';

const call1Model = structuredClone(ILLUSTRATIVE_FUND);
const call1 = issuedCallFrom(1, '2026-09-30', '2026-10-14', compute(call1Model).rows);

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2024-01-01',
  createdAt: '2024-01-01T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  lateCloseInterestRate: 0.08,
};

const first: ClosingRecord = {
  id: 'c1',
  closingNo: 1,
  closingDate: '2024-01-01',
  finalised: true,
  result: null,
  commitments: call1Model.lps.map((l) => ({
    lpId: l.LP_ID,
    name: l.LP_Name,
    amount: Number(l.Commitment),
    feeRateOverride: Number(l.Mgmt_Fee_Rate_Override) || null,
    feeExempt: l.Fee_Exempt === 'Y',
  })),
};

const history: FundHistory = { terms: [terms], closings: [first], calls: [call1] };
const figures = (r: LPRow) => [r.LP_ID, r.Commitment, r.Opening_Paid_In, r.Opening_UCC, r.Opening_Invested_Capital];

describe('with no later close', () => {
  it('matches carrying the register forward, to the cent, for every investor', () => {
    const fromRecord = fundRegister(history, '2026-11-01', call1Model);
    expect(fromRecord.ok).toBe(true);
    const carried = carryForwardRegister(call1Model).filter((r) => r.Status === 'Active');
    expect(fromRecord.ok && fromRecord.lps.map(figures)).toEqual(carried.map(figures).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  });

  it('keeps each investor’s details from the previous call and side letters from the closing', () => {
    const r = fundRegister(history, '2026-11-01', call1Model);
    if (!r.ok) throw new Error('expected a register');
    const lp03 = r.lps.find((l) => l.LP_ID === 'LP03')!;
    const before = call1Model.lps.find((l) => l.LP_ID === 'LP03')!;
    expect(lp03).toMatchObject({ LP_Type: before.LP_Type, Contact_Email: before.Contact_Email, Mgmt_Fee_Rate_Override: 0.01, Status: 'Active' });
    expect(r.lps.find((l) => l.LP_ID === 'GP01')!.Fee_Exempt).toBe('Y');
  });
});

describe('after a later close', () => {
  const second: ClosingRecord = {
    id: 'c2',
    closingNo: 2,
    closingDate: '2026-11-01',
    finalised: false,
    result: null,
    commitments: [{ lpId: 'LP07', name: 'Eta Capital', amount: 10_000_000, feeRateOverride: null, feeExempt: false, contactEmail: 'ops@eta.example' }],
  };
  const draft: FundHistory = { ...history, closings: [first, second] };
  const eq = equalize(equalizationInputFor(draft, 'c2')!);
  const after: FundHistory = { ...history, closings: [first, { ...second, finalised: true, result: eq }] };
  const r = fundRegister(after, '2026-12-01', call1Model);
  if (!r.ok) throw new Error('expected a register');

  it('includes the investor it admitted, at what they paid to catch up', () => {
    const lp07 = r.lps.find((l) => l.LP_ID === 'LP07')!;
    const line = eq.lines.find((l) => l.lpId === 'LP07')!;
    expect(lp07.Commitment).toBe(10_000_000);
    expect(lp07.Opening_Paid_In).toBeCloseTo(line.capital + line.catchUpFee, 2);
    expect(lp07.Contact_Email).toBe('ops@eta.example');
    expect(lp07.LP_Type).toBe('');
  });

  it('gives the earlier investors their refunds, where carrying forward would not', () => {
    const carried = carryForwardRegister(call1Model);
    const lp01 = r.lps.find((l) => l.LP_ID === 'LP01')!;
    const refund = eq.lines.find((l) => l.lpId === 'LP01')!;
    expect(refund.capital).toBeLessThan(0);
    expect(lp01.Opening_Paid_In).toBeCloseTo(Number(carried.find((l) => l.LP_ID === 'LP01')!.Opening_Paid_In) + refund.capital, 2);
  });

  it('still adds up: unfunded is commitment less what was drawn, for everyone', () => {
    const committed = r.lps.reduce((s, l) => s + Number(l.Commitment), 0);
    const unfunded = r.lps.reduce((s, l) => s + Number(l.Opening_UCC), 0);
    const drawnBefore = carryForwardRegister(call1Model).reduce((s, l) => s + Number(l.Commitment) - Number(l.Opening_UCC), 0);
    const lateInside = eq.lines.filter((l) => l.role !== 'earlier').reduce((s, l) => s + l.inside + l.catchUpFee, 0);
    const earlierInside = eq.lines.filter((l) => l.role === 'earlier').reduce((s, l) => s + l.inside, 0);
    expect(committed - unfunded).toBeCloseTo(drawnBefore + lateInside + earlierInside, 1);
  });
});

describe('when the calls and the closings disagree', () => {
  it('refuses, and says where, rather than pick one', () => {
    // A transfer inside the call moved 40% of LP05's commitment to LP06.
    const moved = structuredClone(ILLUSTRATIVE_FUND);
    moved.transfers[0].Effective_Date = '2026-09-01';
    const transferred = issuedCallFrom(1, '2026-09-30', '2026-10-14', compute(moved).rows);
    const r = fundRegister({ ...history, calls: [transferred] }, '2026-11-01', moved);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toEqual([
      'Call No. 1 has LP05 committed at 7,500,000.00, but the closings say 12,500,000.00.',
      'Call No. 1 has LP06 committed at 5,000,000.00, but the closings say 0.00.',
    ]);
  });

  it('has nothing to disagree with in a fund with no closings', () => {
    expect(registerMismatches({ ...history, closings: [] })).toEqual([]);
  });
});

describe('the fund’s totals from the record', () => {
  it('agree with the register carried forward, for a fund with closings', () => {
    const p = positionFromRecord(history, '2026-11-01')!;
    const carried = carryForwardRegister(call1Model).filter((r) => r.Status === 'Active');
    expect(p.investors).toBe(carried.length);
    expect(p.totalCommitments).toBe(carried.reduce((s, r) => s + Number(r.Commitment), 0));
    expect(p.paidInCapital).toBeCloseTo(carried.reduce((s, r) => s + Number(r.Opening_Paid_In), 0), 2);
    expect(p.unfundedCommitment).toBeCloseTo(carried.reduce((s, r) => s + Number(r.Opening_UCC), 0), 2);
  });

  it('are not offered for a fund with no closings, or one whose calls disagree with them', () => {
    expect(positionFromRecord({ ...history, closings: [] }, '2026-11-01')).toBeNull();
    const moved = structuredClone(ILLUSTRATIVE_FUND);
    moved.transfers[0].Effective_Date = '2026-09-01';
    const transferred = issuedCallFrom(1, '2026-09-30', '2026-10-14', compute(moved).rows);
    expect(positionFromRecord({ ...history, calls: [transferred] }, '2026-11-01')).toBeNull();
  });
});

describe('a call’s register against the fund’s record', () => {
  const on = '2026-11-01';
  const fromRecord = () => {
    const r = fundRegister(history, on, call1Model);
    if (!r.ok) throw new Error('expected a register');
    return r.lps;
  };

  it('agrees when the register was read from the record', () => {
    expect(registerDifferences(history, fromRecord(), on)).toEqual([]);
  });

  it('names an investor the fund never admitted, one missing, and a balance that is off', () => {
    const lps = fromRecord()
      .filter((l) => l.LP_ID !== 'LP02')
      .map((l) => (l.LP_ID === 'LP01' ? { ...l, Opening_Paid_In: Number(l.Opening_Paid_In) + 100 } : l));
    lps.push({ ...lps[0], LP_ID: 'LP99', LP_Name: 'Stranger', Commitment: 1_000_000 });
    const found = registerDifferences(history, lps, on);
    expect(found.map((d) => [d.lpId, d.kind])).toEqual([
      ['LP01', 'paidIn'],
      ['LP99', 'unknown'],
      ['LP02', 'missing'],
    ]);
    expect(found[0].text).toMatch(/^LP01 paid in before this call: .* here, .* in the fund's record\.$/);
  });

  it('has nothing to say for a fund with no closings', () => {
    expect(registerDifferences({ ...history, closings: [] }, [], on)).toEqual([]);
  });
});

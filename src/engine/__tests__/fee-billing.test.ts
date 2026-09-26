/**
 * Billing the fee on calls: what each period still owes.
 *
 * The fund: first close 1 Jan 2026, LP01 6m at 2%, LP02 4m on a 1% side
 * letter, GP01 1m exempt; quarterly. A second close on 1 Aug admits LP07 5m.
 *   Q1, Q2 each: LP01 30,000 · LP02 10,000 · GP01 0
 *   Q3 after the close: LP07 5,000,000 × 2% × 0.25 × 61/92 = 16,576.09
 */

import { describe, expect, it } from 'vitest';
import { buildFeeSchedule, defaultFeePeriods, feeOwed, feeScheduleDifferences, scheduleLabel } from '../fee-billing';
import { type ClosingRecord, type FundHistory } from '../fund-history';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import type { IssuedCall } from '../positions';

const terms: FundTerms = { ...BLANK_TERMS, effectiveFrom: '2026-01-01', createdAt: '', feeBasis: 'Commitment', feeRateAnnual: 0.02, feePeriodFraction: 0.25, feeReducesUnfunded: true };
const first: ClosingRecord = {
  id: 'c1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
  commitments: [
    { lpId: 'LP01', name: 'Alpha', amount: 6e6, feeRateOverride: null, feeExempt: false },
    { lpId: 'LP02', name: 'Beta', amount: 4e6, feeRateOverride: 0.01, feeExempt: false },
    { lpId: 'GP01', name: 'GP', amount: 1e6, feeRateOverride: null, feeExempt: true },
  ],
};
const second: ClosingRecord = {
  id: 'c2', closingNo: 2, closingDate: '2026-08-01', finalised: true, result: null,
  commitments: [{ lpId: 'LP07', name: 'Eta', amount: 5e6, feeRateOverride: null, feeExempt: false }],
};
const line = (lpId: string, fee: number) => ({ lpId, name: lpId, commitment: 0, openPaid: 0, openUnfunded: 0, openInvested: 0, total: fee, reduces: fee, capital: 0, inside: 0, deal: 0 });
const history = (calls: IssuedCall[], closings = [first]): FundHistory => ({ terms: [terms], closings, calls });
const q = (label: string, o: ReturnType<typeof feeOwed>) => o.find((p) => p.period.label === label)!;

describe('what each period owes', () => {
  it('is the whole fee while nothing has been billed, and nothing for someone exempt', () => {
    const q1 = q('Q1 2026', feeOwed(history([]), '2026-09-30'));
    expect(q1.owed).toEqual({ LP01: 30_000, LP02: 10_000 });
    expect(q1.owedTotal).toBe(40_000);
  });

  it('is only what a later close added, once the rest of the period was billed', () => {
    // Q3 billed on Call 1 before the second close admitted LP07.
    const call1: IssuedCall = { callNo: 1, callDate: '2026-07-05', dueDate: '2026-07-20', lines: [], feeSchedule: [{ from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP01: 30_000, LP02: 10_000 } }] };
    const q3 = q('Q3 2026', feeOwed(history([call1], [first, second]), '2026-09-30'));
    expect(q3.owed).toEqual({ LP07: 16_576.09 });
    expect(q3.billedOn).toEqual([{ callNo: 1, amount: 40_000 }]);
  });

  it('counts a call from before schedules as billing the period its date falls in', () => {
    const legacy: IssuedCall = { callNo: 1, callDate: '2026-02-10', dueDate: '2026-02-24', lines: [line('LP01', 30_000), line('LP02', 10_000)] };
    expect(q('Q1 2026', feeOwed(history([legacy]), '2026-09-30')).owedTotal).toBe(0);
  });

  it('reports billing more than is owed as a credit, and never bills it', () => {
    const over: IssuedCall = { callNo: 1, callDate: '2026-02-10', dueDate: '2026-02-24', lines: [], feeSchedule: [{ from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026', byLp: { LP01: 31_000, LP02: 10_000 } }] };
    const q1 = q('Q1 2026', feeOwed(history([over]), '2026-09-30'));
    expect([q1.owedTotal, q1.creditTotal]).toEqual([0, 1_000]);
    expect(buildFeeSchedule([q1], [q1.period])[0].byLp).toEqual({});
  });

  it('leaves the call being set up out of what was billed', () => {
    const draft: IssuedCall = { callNo: 3, callDate: '2026-02-10', dueDate: '', lines: [], feeSchedule: [{ from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026', byLp: { LP01: 30_000 } }] };
    expect(q('Q1 2026', feeOwed(history([draft]), '2026-09-30', 3)).owedTotal).toBe(40_000);
  });
});

describe('a call billing several periods, as after a credit line', () => {
  const owed = feeOwed(history([]), '2026-09-30');

  it('bills each period chosen, investor by investor', () => {
    const schedule = buildFeeSchedule(owed, [owed[0].period, owed[1].period]);
    expect(schedule.map((e) => [e.label, e.byLp])).toEqual([
      ['Q1 2026', { LP01: 30_000, LP02: 10_000 }],
      ['Q2 2026', { LP01: 30_000, LP02: 10_000 }],
    ]);
    expect(scheduleLabel(schedule)).toBe('Q1–Q2 2026');
  });

  it('defaults to the period the call falls in when billed in advance, the last ended one in arrears', () => {
    expect(defaultFeePeriods(owed, '2026-08-15', 'advance')).toEqual([{ from: '2026-07-01', to: '2026-09-30' }]);
    expect(defaultFeePeriods(owed, '2026-08-15', 'arrears')).toEqual([{ from: '2026-04-01', to: '2026-06-30' }]);
  });

  it('says where a stored schedule no longer matches what is owed', () => {
    const stored = buildFeeSchedule(owed, [owed[0].period]);
    const fresh = [{ ...stored[0], byLp: { LP02: 10_000 } }];
    expect(feeScheduleDifferences(stored, fresh)).toEqual(["Q1 2026: LP01's fee is 30,000.00 on this call, but 0.00 is what is owed now."]);
    expect(feeScheduleDifferences(stored, stored)).toEqual([]);
  });
});

describe('a call with a schedule', () => {
  it('charges each investor the scheduled amounts, and keeps offsets against them', async () => {
    const { compute } = await import('../compute');
    const { ILLUSTRATIVE_FUND } = await import('../fixtures/illustrative-fund');
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.feeSchedule = [
      { from: '2026-04-01', to: '2026-06-30', label: 'Q2 2026', byLp: { LP01: 50_000, LP02: 37_500 } },
      { from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP01: 50_000 } },
    ];
    const r = compute(model);
    const lp01 = r.rows.find((x) => x.LP_ID === 'LP01')!;
    expect([lp01.feeGross, lp01.feeByPeriod]).toEqual([100_000, [50_000, 50_000]]);
    expect(r.rows.find((x) => x.LP_ID === 'LP03')!.feeGross).toBe(0);
    expect(r.fee.schedule?.map((e) => [e.label, e.total])).toEqual([['Q2 2026', 87_500], ['Q3 2026', 50_000]]);
    // The 50,000 offset still comes off, over those who pay a fee.
    expect(r.totals.feeOffset).toBe(50_000);
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('refuses a schedule that charges someone not on the register', async () => {
    const { compute } = await import('../compute');
    const { ILLUSTRATIVE_FUND } = await import('../fixtures/illustrative-fund');
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.feeSchedule = [{ from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP99: 1_000 } }];
    const r = compute(model);
    expect(r.checks.filter((c) => c.level === 'fail').map((c) => c.text)).toEqual(["The fee schedule charges LP99, who is not on this call's register."]);
    // Named on the result too, so the screen can say who is missing without re-deriving it.
    expect(r.fee.notOnRegister).toEqual(['LP99']);
  });
});

describe('the fee ledger, once calls bill the fee', () => {
  it('compares with what was billed, so a period billed in full after the close is billed', async () => {
    const { feeLedgerFor } = await import('../fee-billing');
    // Q3 billed after the second close admitted LP07, in full, on Call 2.
    const after = history([], [first, second]);
    const owedNow = feeOwed(after, '2026-09-30').find((o) => o.period.label === 'Q3 2026')!;
    const call2: IssuedCall = { callNo: 2, callDate: '2026-08-10', dueDate: '', lines: [], feeSchedule: buildFeeSchedule([owedNow], [owedNow.period]) };
    const q3 = feeLedgerFor({ ...after, calls: [call2] }, '2026-09-30').find((e) => e.period.label === 'Q3 2026')!;
    expect(q3.billedOn).toEqual([{ callNo: 2, amount: 56_576.09 }]);
    expect(q3.status).toBe('billed');
  });
});

describe('the catch-up fee a later close charged', () => {
  const closed = async (feeTo: FundTerms['catchUpFeeTo']) => {
    const { equalize } = await import('../equalization');
    const { equalizationInputFor } = await import('../fund-history');
    const { catchUpFeesFor } = await import('../fee-billing');
    const t = { ...terms, catchUpFeeTo: feeTo };
    const draft: FundHistory = { terms: [t], closings: [first, { ...second, finalised: false }], calls: [] };
    const result = equalize(equalizationInputFor(draft, 'c2')!);
    return catchUpFeesFor({ ...draft, closings: [first, { ...second, result }] });
  };

  // LP07, 5,000,000 at 2%, for 1 Jan – 31 Jul: 25,000 + 25,000 + 25,000 × 31/92 = 58,423.91
  it('is the manager’s fee income when the terms give it to the manager', async () => {
    const [c] = await closed('gp');
    expect(c).toMatchObject({ closingNo: 2, from: '2026-01-01', to: '2026-07-31', recipient: 'manager', total: 58_423.91, toManager: 58_423.91 });
    expect(c.paidBy).toEqual([{ lpId: 'LP07', name: 'Eta', fee: 58_423.91 }]);
    expect(c.receivedBy).toEqual([]);
  });

  it('only moves money between investors when it goes to those already in', async () => {
    const [c] = await closed('existing_lps');
    expect(c.recipient).toBe('existing_lps');
    expect(c.toManager).toBe(0);
    expect(c.paidBy.map((p) => p.fee)).toEqual([58_423.91]);
    // Split by commitment among everyone already in, and it ties to the cent.
    expect(c.receivedBy.map((r) => r.lpId).sort()).toEqual(['GP01', 'LP01', 'LP02']);
    expect(round2(c.receivedBy.reduce((s, r) => s + r.fee, 0))).toBe(58_423.91);
  });

  it('is nothing for a closing still in draft', async () => {
    const { catchUpFeesFor } = await import('../fee-billing');
    expect(catchUpFeesFor(history([], [first, { ...second, finalised: false }]))).toEqual([]);
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;

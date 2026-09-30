/**
 * A later closing settled on the next call: the fund manager's rules, end to end.
 *
 * First close 1 Jan 2026: LP01 6m, LP02 4m. Call 1 (due 15 Feb) 1,000,000 all
 * against commitment; call 2 (due 15 May) 2,000,000, 1,800,000 against it.
 * Second close 1 Aug admits LP07 5m, settled on the next call. Terms: 2% on
 * commitment quarterly, counting against commitment; 8% simple late-close
 * interest to the earlier investors; the catch-up fee to the GP, with interest
 * from the first close. Call 3, due 15 Sep, is a 1,500,000 deal on unfunded
 * (UCC) and bills no fee.
 *
 * Worked by hand:
 *   LP07 capital 333,333.33 + 666,666.67 = 1,000,000; inside 933,333.33
 *   catch-up fee 58,423.91 (1 Jan – 31 Jul), fee interest 58,423.91 × 8% × 212/365 = 2,714.71
 *   capital interest to 15 Sep: call 1, 212 days: 15,488.58; call 2, 123 days: 17,972.60 → 33,461.18
 *     earlier investors by what they paid (6 : 4): call 1 9,293.15 / 6,195.43; call 2 10,783.56 / 7,189.04
 *
 *   Opening on call 3, before the equalization moves anything:
 *     LP01 paid 1,800,000, unfunded 4,320,000   LP02 1,200,000 / 2,880,000   LP07 0 / 5,000,000
 *   Unfunded after the equalization, what the deal is shared on:
 *     LP01 4,880,000   LP02 3,253,333.33   LP07 5,000,000 − 933,333.33 − 58,423.91 = 4,008,242.76
 *     total 12,141,576.09
 *   Deal 1,500,000 on that: LP02 401,924.75, LP07 495,188.11, LP01 (plug) 602,887.14
 *   (on the opening balances it would have been 531,147.54 / 354,098.36 / 614,754.10 —
 *    LP07 over-called by 119,565.99)
 */

import { describe, expect, it } from 'vitest';
import { compute } from '../compute';
import { amountDue, buildEqualizationSchedule, equalizationOwed } from '../equalization-billing';
import { equalize } from '../equalization';
import { capitalAccount } from '../capital-account';
import { equalizationInputFor, positionsOn, type ClosingRecord, type FundHistory } from '../fund-history';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import { buildNotice } from '../notice';
import type { IssuedCall } from '../positions';
import type { CallModel } from '../types';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  feeReducesUnfunded: true,
  lateCloseInterestRate: 0.08,
  lateCloseInterestBasis: 'simple',
  equalizationInterestTo: 'existing_lps',
  catchUpFeeTo: 'gp',
  // No fee period is billed before the late close here: the catch-up runs to the closing, as these figures were worked.
  catchUpFeeUntil: 'closing_date',
};
const line = (lpId: string, commitment: number, openPaid: number, capital: number, inside: number) => ({
  lpId, name: lpId, commitment, openPaid, openUnfunded: commitment - openPaid, openInvested: 0, total: capital, reduces: inside, capital, inside, deal: inside,
});
const call1: IssuedCall = { callNo: 1, callDate: '2026-02-01', dueDate: '2026-02-15', lines: [line('LP01', 6e6, 0, 600_000, 600_000), line('LP02', 4e6, 0, 400_000, 400_000)] };
const call2: IssuedCall = {
  callNo: 2, callDate: '2026-05-01', dueDate: '2026-05-15',
  lines: [line('LP01', 6e6, 600_000, 1_200_000, 1_080_000), line('LP02', 4e6, 400_000, 800_000, 720_000)],
};
const first: ClosingRecord = {
  id: 'k1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
  commitments: [
    { lpId: 'LP01', name: 'LP01', amount: 6e6, feeRateOverride: null, feeExempt: false },
    { lpId: 'LP02', name: 'LP02', amount: 4e6, feeRateOverride: null, feeExempt: false },
  ],
};
const second: ClosingRecord = {
  id: 'k2', closingNo: 2, closingDate: '2026-08-01', finalised: false, result: null,
  commitments: [{ lpId: 'LP07', name: 'LP07', amount: 5e6, feeRateOverride: null, feeExempt: false }],
};
const result = equalize(equalizationInputFor({ terms: [terms], closings: [first, second], calls: [call1, call2] }, 'k2')!);
const history = (calls: IssuedCall[] = [call1, call2]): FundHistory => ({
  terms: [terms],
  closings: [first, { ...second, finalised: true, result, settlement: 'next_call' }],
  calls,
});

// Call 3's register, from the record as it stands before it.
const before = positionsOn(history(), '2026-09-01');
const schedule = buildEqualizationSchedule(equalizationOwed(history(), '2026-09-01', { dueDate: '2026-09-15' }));
const model: CallModel = {
  setup: {
    Fund_Name: 'Settle Fund', Reporting_Currency: 'USD', Call_Number: 3, Call_Date: '2026-09-01', Payment_Due_Date: '2026-09-15',
    Default_Mgmt_Fee_Rate_Annual: 0.02, Default_Mgmt_Fee_Basis: 'Commitment', Mgmt_Fee_Period_Fraction: 0.25, Org_Expense_Cap: '',
    Rounding_Decimals: 2, Rounding_Plug_LP_ID: 'LP01', Prepared_By: 'test',
  },
  lps: before.map((p) => ({
    LP_ID: p.lpId, LP_Name: p.name, LP_Type: 'LP', Commitment: p.commitment, Opening_Paid_In: p.paidIn, Opening_UCC: p.unfunded,
    Opening_Invested_Capital: p.invested, Mgmt_Fee_Rate_Override: '', Fee_Exempt: 'N', Status: 'Active',
  })),
  components: [{ Component_ID: 'D1', Component_Name: 'Deal', Category: 'Deal', Total_Amount: 1_500_000, Allocation_Basis: 'UCC', Reduces_Unfunded: 'Y' }],
  fee: { Fee_Basis: 'Commitment', Default_Fee_Rate_Annual: 0.02, Fee_Period_Fraction: 0.25, Reduces_Unfunded: 'Y', offsets: [] },
  transfers: [],
  feeSchedule: [],
  equalizationSchedule: schedule,
};
const r = compute(model);
const row = (id: string) => r.rows.find((x) => x.LP_ID === id)!;

describe('the call that collects it', () => {
  it('opens with the late investor at nothing paid and the whole commitment unfunded', () => {
    expect(row('LP07')).toMatchObject({ openPaid: 0, openUCC: 5_000_000 });
    expect(row('LP01')).toMatchObject({ openPaid: 1_800_000, openUCC: 4_320_000 });
    expect(row('LP02')).toMatchObject({ openPaid: 1_200_000, openUCC: 2_880_000 });
  });

  it('works out the equalization with interest to its own due date', () => {
    const [e] = schedule;
    expect(e).toMatchObject({ interestUntil: '2026-09-15', interestToDueDate: true, settles: 'on_call', feeReducesUnfunded: true });
    expect(e.parts.LP07).toEqual({ capital: 1_000_000, inside: 933_333.33, interest: 33_461.18, catchUpFee: 58_423.91, feeInterest: 2_714.71 });
    expect(e.parts.LP01).toMatchObject({ capital: -600_000, inside: -560_000, interest: -20_076.71 });
    expect(e.parts.LP02).toMatchObject({ capital: -400_000, inside: -373_333.33, interest: -13_384.47 });
  });

  it('shares a UCC deal on unfunded after the equalization, not before', () => {
    expect([row('LP01'), row('LP02'), row('LP07')].map((x) => x.comps[0].amt)).toEqual([602_887.14, 401_924.75, 495_188.11]);
  });

  it('moves paid-in and unfunded on the call, interest in neither', () => {
    // LP07: paid 495,188.11 + 1,058,423.91 = 1,553,612.02; unfunded 5,000,000 − 495,188.11 − 991,757.24 = 3,513,054.65
    expect(row('LP07')).toMatchObject({ eqPaid: 1_058_423.91, eqReduces: 991_757.24, closingPaid: 1_553_612.02, closingUCC: 3_513_054.65 });
    // LP01: paid 1,800,000 + 602,887.14 − 600,000 = 1,802,887.14; unfunded 4,320,000 − 602,887.14 + 560,000 = 4,277,112.86
    expect(row('LP01')).toMatchObject({ eqPaid: -600_000, eqReduces: -560_000, closingPaid: 1_802_887.14, closingUCC: 4_277_112.86 });
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('asks the late investor for the deal and the equalization together', () => {
    // 495,188.11 + 1,000,000 + 33,461.18 + 58,423.91 + 2,714.71 = 1,589,787.91
    expect(amountDue(row('LP07'))).toBe(1_589_787.91);
  });

  it('shows the equalization in the notice’s account, so the column adds up', () => {
    const n = buildNotice(model, r, row('LP07'));
    expect(n.account).toEqual(
      expect.arrayContaining([
        { label: 'Contributions prior to this call', amt: '0.00' },
        { label: 'Equalization — contributed this notice', amt: '1,058,423.91' },
        { label: 'Total Contributions to Date', amt: '1,553,612.02', strong: true },
        { label: 'Less: equalization applied against commitment', amt: '(991,757.24)' },
        { label: 'Unfunded Commitment — after this call', amt: '3,513,054.65', strong: true },
      ]),
    );
  });
});

describe('once it is sent', () => {
  const sent: IssuedCall = {
    callNo: 3, callDate: '2026-09-01', dueDate: '2026-09-15', equalizationSchedule: schedule,
    lines: r.rows.map((x) => line(x.LP_ID, Number(x.Commitment), x.openPaid, x.total, x.reduces)),
  };
  const after = history([call1, call2, sent]);

  it('the record ends where the call did', () => {
    const p = positionsOn(after, '2026-10-01');
    for (const id of ['LP01', 'LP02', 'LP07']) {
      expect(p.find((x) => x.lpId === id)).toMatchObject({ paidIn: row(id).closingPaid, unfunded: row(id).closingUCC });
    }
  });

  it('the capital account ends on the same figures, the equalization dated on the call', () => {
    for (const id of ['LP01', 'LP07']) {
      const a = capitalAccount(after, id, '2026-10-01');
      const last = a.entries[a.entries.length - 1];
      expect(last).toMatchObject({ paidAfter: row(id).closingPaid, unfundedAfter: row(id).closingUCC });
      expect(a.entries.find((e) => e.kind === 'equalization')?.date).toBe('2026-09-01');
    }
  });

  it('owes nothing more on a later call', () => {
    expect(equalizationOwed(after, '2026-12-01', { dueDate: '2026-12-15' })[0].owed).toEqual({});
  });
});

describe('settled now instead, by statement', () => {
  const byStatement = (statementDueDate: string | null): FundHistory => ({
    terms: [terms],
    closings: [first, { ...second, finalised: true, result, settlement: 'on_closing', statementDueDate }],
    calls: [call1, call2],
  });
  const interestOf = (h: FundHistory) => capitalAccount(h, 'LP07', '2026-10-01').entries.find((e) => e.kind === 'equalization')!.interest;

  it('shows interest to the date the sent statements are payable by', () => {
    // To 15 Sep: 15,488.58 + 17,972.60 = 33,461.18, plus 2,714.71 on the fee = 36,175.89
    expect(interestOf(byStatement('2026-09-15'))).toBeCloseTo(36_175.89, 2);
  });

  it('and to the closing date before any is sent', () => {
    // To 1 Aug: 12,200.91 + 11,397.26 = 23,598.17, plus 2,714.71 = 26,312.88
    expect(interestOf(byStatement(null))).toBeCloseTo(26_312.88, 2);
  });
});

/**
 * Fund terms: which apply on a date, which are still unset, and how they start
 * a new call.
 */

import { describe, expect, it } from 'vitest';
import { emptyCall } from '../empty-call';
import {
  BLANK_TERMS,
  afterInvestmentPeriod,
  applyFundTerms,
  changedTerms,
  draftTerms,
  scheduledAfter,
  termsOn,
  unsetTerms,
  termApplies,
  withoutOrphans,
  type FundTerms,
} from '../fund-terms';
import { dayAfter, dayBefore } from '../dates';

const terms = (patch: Partial<FundTerms>): FundTerms => ({ ...BLANK_TERMS, ...patch });

const history: FundTerms[] = [
  terms({ effectiveFrom: '2024-01-01', createdAt: '2024-01-02T10:00:00Z', feeRateAnnual: 0.02, feeBasis: 'Commitment' }),
  // The investment period ends; the fee steps down and moves to invested capital.
  terms({ effectiveFrom: '2029-01-01', createdAt: '2024-01-02T10:05:00Z', feeRateAnnual: 0.015, feeBasis: 'Invested_Capital' }),
  // A correction to the first row, entered later, same date.
  terms({ effectiveFrom: '2024-01-01', createdAt: '2024-03-01T09:00:00Z', feeRateAnnual: 0.0175, feeBasis: 'Commitment' }),
];

describe('which terms apply on a date', () => {
  it('is the latest row on or before it', () => {
    expect(termsOn(history, '2026-06-30')?.feeRateAnnual).toBe(0.0175);
    expect(termsOn(history, '2029-01-01')?.feeRateAnnual).toBe(0.015);
    expect(termsOn(history, '2031-12-31')?.feeBasis).toBe('Invested_Capital');
  });

  it('prefers the later-entered row when two share a date', () => {
    // 0.02 was entered first, 0.0175 corrected it. The correction wins.
    expect(termsOn(history, '2024-01-01')?.feeRateAnnual).toBe(0.0175);
  });

  it('is nothing before the first row', () => {
    expect(termsOn(history, '2023-12-31')).toBeNull();
    expect(termsOn([], '2026-01-01')).toBeNull();
  });

  it('does not depend on the order the rows arrive in', () => {
    expect(termsOn([...history].reverse(), '2026-06-30')?.feeRateAnnual).toBe(0.0175);
  });
});

describe('which settings are still unset', () => {
  it('lists every blank one, so a default is never mistaken for a choice', () => {
    const set = terms({ effectiveFrom: '2024-01-01', feeTiming: 'arrears', feeRateAnnual: 0.02 });
    const unset = unsetTerms(set);
    expect(unset).toContain('feeDayCount');
    expect(unset).toContain('catchUpFeeTo');
    expect(unset).not.toContain('feeTiming');
    expect(unset).not.toContain('feeRateAnnual');
  });

  it('does not count bookkeeping fields as settings', () => {
    const unset = unsetTerms(BLANK_TERMS);
    expect(unset).not.toContain('note');
    expect(unset).not.toContain('createdAt');
    expect(unset).not.toContain('effectiveFrom');
  });
});

describe('a fund\u2019s terms, put into a call', () => {
  const inForce = terms({
    effectiveFrom: '2024-01-01',
    reportingCurrency: 'USD',
    roundingDecimals: 2,
    roundingPlugLpId: 'LP04',
    feeBasis: 'Commitment',
    feeRateAnnual: 0.02,
    feePeriodFraction: 0.25,
    feeReducesUnfunded: true,
    feeExemptLpIds: ['GP01'],
    orgExpenseCap: 1500000,
    gpName: 'Illustrative GP LLC',
    signatoryName: 'Jane Doe',
  });

  it('fills every cell the terms cover, in both places the fee lives', () => {
    const { model } = applyFundTerms(emptyCall('F'), inForce);
    expect(model.setup.Reporting_Currency).toBe('USD');
    expect(model.setup.Rounding_Decimals).toBe(2);
    expect(model.setup.Org_Expense_Cap).toBe(1500000);
    expect(model.setup.GP_Name).toBe('Illustrative GP LLC');
    expect(model.fee.Fee_Basis).toBe('Commitment');
    expect(model.setup.Default_Mgmt_Fee_Basis).toBe('Commitment');
    expect(model.fee.Default_Fee_Rate_Annual).toBe(0.02);
    expect(model.setup.Default_Mgmt_Fee_Rate_Annual).toBe(0.02);
    expect(model.fee.Fee_Period_Fraction).toBe(0.25);
    expect(model.fee.Reduces_Unfunded).toBe('Y');
    expect(model.fee.Fee_Exempt_LP_IDs).toBe('GP01');
  });

  it('locks every fund-level cell, and only those', () => {
    const { locked } = applyFundTerms(emptyCall('F'), inForce);
    expect(locked.has('setup.GP_Name')).toBe(true);
    expect(locked.has('fee.Default_Fee_Rate_Annual')).toBe(true);
    // Blank in these terms, but still the fund's to decide, not the call's.
    expect(locked.has('setup.Signatory_Title')).toBe(true);
    // Not a fund term, or deliberately the call's own.
    expect(locked.has('setup.Call_Date')).toBe(false);
    expect(locked.has('setup.Rounding_Plug_LP_ID')).toBe(false);
  });

  it('clears what a call or a workbook put in a cell the fund left blank, and says so', () => {
    const call = emptyCall('F');
    call.setup.Signatory_Title = 'Partner';
    call.fee.Fee_Exempt_LP_IDs = 'LP09';
    const onlyCurrency = terms({ effectiveFrom: '2024-01-01', reportingCurrency: 'EUR' });
    const { model, locked, changed } = applyFundTerms(call, onlyCurrency);
    expect(model.setup.Signatory_Title).toBe('');
    expect(model.fee.Fee_Exempt_LP_IDs).toBe('');
    expect(locked.has('setup.Signatory_Title')).toBe(true);
    expect(changed.map((c) => [c.key, c.was, c.now])).toEqual(
      expect.arrayContaining([
        ['Signatory_Title', 'Partner', ''],
        ['Fee_Exempt_LP_IDs', 'LP09', ''],
      ]),
    );
  });

  it('changes nothing for a fund with no terms', () => {
    const call = emptyCall('F');
    const { model, locked, changed } = applyFundTerms(call, null);
    expect(model).toEqual(call);
    expect(locked.size).toBe(0);
    expect(changed).toEqual([]);
  });

  it('says what it replaced, and nothing it did not', () => {
    const call = emptyCall('F');
    call.fee.Default_Fee_Rate_Annual = 0.025;
    call.setup.Reporting_Currency = 'USD';
    const { changed } = applyFundTerms(call, inForce);
    expect(changed).toContainEqual({ step: 'fee', key: 'Default_Fee_Rate_Annual', was: 0.025, now: 0.02 });
    expect(changed.some((c) => c.key === 'Reporting_Currency')).toBe(false);
  });

  it('pre-fills the fund\u2019s usual rounding plug on a new call, without taking over one already chosen', () => {
    expect(applyFundTerms(emptyCall('F'), inForce, { prefillPlug: true }).model.setup.Rounding_Plug_LP_ID).toBe('LP04');
    const chosen = emptyCall('F');
    chosen.setup.Rounding_Plug_LP_ID = 'LP01';
    expect(applyFundTerms(chosen, inForce, { prefillPlug: true }).model.setup.Rounding_Plug_LP_ID).toBe('LP01');
    expect(applyFundTerms(emptyCall('F'), inForce).model.setup.Rounding_Plug_LP_ID).toBe('');
  });

  it('keeps a fee that does not reduce unfunded as N, not blank', () => {
    const { model } = applyFundTerms(emptyCall('F'), terms({ effectiveFrom: '2024-01-01', feeReducesUnfunded: false }));
    expect(model.fee.Reduces_Unfunded).toBe('N');
  });

  it('does not change the call it was given', () => {
    const call = emptyCall('F');
    applyFundTerms(call, inForce);
    expect(call.setup.Reporting_Currency).toBe('');
  });
});

describe('what a change was', () => {
  it('names only the terms that moved', () => {
    const [first, stepDown] = [history[0], history[1]];
    expect(changedTerms(first, stepDown).sort()).toEqual(['feeBasis', 'feeRateAnnual']);
  });

  it('counts every set term as new on the first row', () => {
    expect(changedTerms(null, history[0]).sort()).toEqual(['feeBasis', 'feeRateAnnual']);
  });

  it('ignores when it was entered and the note', () => {
    const again = { ...history[0], createdAt: '2025-01-01T00:00:00Z', note: 'retyped' };
    expect(changedTerms(history[0], again)).toEqual([]);
  });
});

describe('suggestions for a term nobody has set', () => {
  it('fill the form where the fund has nothing, and say which they were', () => {
    const { terms: draft, suggested } = draftTerms(null);
    expect(draft.reportingCurrency).toBe('USD');
    expect(draft.feeBasis).toBe('Commitment');
    expect(suggested).toContain('reportingCurrency');
    // No common fee rate exists, so none is suggested.
    expect(draft.feeRateAnnual).toBeNull();
  });

  it('never override what the fund has recorded', () => {
    const recorded = terms({ effectiveFrom: '2024-01-01', reportingCurrency: 'EUR', feeTiming: 'arrears' });
    const { terms: draft, suggested } = draftTerms(recorded);
    expect(draft.reportingCurrency).toBe('EUR');
    expect(draft.feeTiming).toBe('arrears');
    expect(suggested).not.toContain('reportingCurrency');
    expect(suggested).toContain('feeDayCount');
  });

  it('are not stored by suggesting them: the terms in force still show them unset', () => {
    draftTerms(null);
    expect(unsetTerms(BLANK_TERMS)).toContain('reportingCurrency');
  });
});

describe('the fee after the investment period', () => {
  const during = terms({
    effectiveFrom: '2024-01-01',
    investmentPeriodEnd: '2028-12-31',
    feeBasis: 'Commitment',
    feeRateAnnual: 0.02,
    reportingCurrency: 'USD',
  });

  it('is the same terms, from the day after the period ends, with the new basis and rate', () => {
    const after = afterInvestmentPeriod(during, { feeBasis: 'Invested_Capital', feeRateAnnual: 0.015 });
    expect(after.effectiveFrom).toBe('2029-01-01');
    expect(after.feeBasis).toBe('Invested_Capital');
    expect(after.feeRateAnnual).toBe(0.015);
    expect(after.reportingCurrency).toBe('USD');
  });

  it('is what termsOn gives on either side of the date', () => {
    const after = { ...afterInvestmentPeriod(during, { feeBasis: 'Invested_Capital', feeRateAnnual: 0.015 }), createdAt: '2024-01-02T00:00:00Z' };
    expect(termsOn([during, after], '2028-12-31')?.feeBasis).toBe('Commitment');
    expect(termsOn([during, after], '2029-01-01')?.feeBasis).toBe('Invested_Capital');
  });

  it('cannot be scheduled without knowing when the period ends', () => {
    expect(() => afterInvestmentPeriod({ ...during, investmentPeriodEnd: null }, { feeBasis: 'Invested_Capital', feeRateAnnual: 0.015 })).toThrow(/investment period ends/);
  });

  it('shows as scheduled until it starts', () => {
    const after = { ...afterInvestmentPeriod(during, { feeBasis: 'Invested_Capital', feeRateAnnual: 0.015 }), createdAt: '2024-01-02T00:00:00Z' };
    expect(scheduledAfter([during, after], '2026-09-25').map((r) => r.effectiveFrom)).toEqual(['2029-01-01']);
    expect(scheduledAfter([during, after], '2029-01-01')).toEqual([]);
  });
});

describe('dates', () => {
  it('rolls over months and leap years in UTC', () => {
    expect(dayAfter('2028-12-31')).toBe('2029-01-01');
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
    expect(dayAfter('2027-02-28')).toBe('2027-03-01');
    expect(dayBefore('2029-01-01')).toBe('2028-12-31');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });
});

describe('terms that only apply once another is set', () => {
  it('clears who gets late-close interest, and how it is worked, when there is no interest', () => {
    const t = withoutOrphans({ ...BLANK_TERMS, lateCloseInterestBasis: 'simple', equalizationInterestTo: 'gp' });
    expect([t.lateCloseInterestBasis, t.equalizationInterestTo]).toEqual([null, null]);
    const kept = withoutOrphans({ ...BLANK_TERMS, lateCloseInterestRate: 0.08, equalizationInterestTo: 'gp' });
    expect(kept.equalizationInterestTo).toBe('gp');
  });

  it('treats a rate of zero as none', () => {
    expect(termApplies({ feeRateAnnual: 0, lateCloseInterestRate: null }, 'feeBasis')).toBe(false);
    expect(termApplies({ feeRateAnnual: 0.02, lateCloseInterestRate: null }, 'feeBasis')).toBe(true);
  });

  it('does not call a term that does not apply "not set"', () => {
    expect(unsetTerms({ ...BLANK_TERMS, effectiveFrom: '2026-01-01', createdAt: '' })).not.toContain('equalizationInterestTo');
    expect(unsetTerms({ ...BLANK_TERMS, effectiveFrom: '2026-01-01', createdAt: '', lateCloseInterestRate: 0.08 })).toContain('equalizationInterestTo');
  });
});

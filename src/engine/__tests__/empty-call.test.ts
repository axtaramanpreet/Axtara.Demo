/**
 * A new call starts blank.
 *
 * It used to start from the illustrative fixture, so a real first call arrived
 * carrying another fund's fee rate, organizational cap and rounding plug, with
 * the notice headed "Illustrative Fund II, L.P.". Every figure looked chosen.
 * These tests pin the blankness, and pin that the engine says what is missing
 * rather than computing quietly around it.
 */

import { describe, expect, it } from 'vitest';
import { compute, emptyCall } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { canApprove } from '@/server/notice-policy';

describe('a new, empty call', () => {
  const model = emptyCall('Thornfield Continuation Fund II, L.P.');

  it('takes only the fund name, which the app already knows', () => {
    expect(model.setup.Fund_Name).toBe('Thornfield Continuation Fund II, L.P.');
  });

  it('decides nothing else about the fund', () => {
    const decided = Object.entries(model.setup)
      .filter(([key, value]) => key !== 'Fund_Name' && value !== '')
      .map(([key]) => key);
    expect(decided).toEqual([]);
  });

  it('carries no economics from any other fund', () => {
    // The specific values that used to leak through, named so that a
    // reintroduced template seed fails here rather than on someone's notice.
    expect(model.setup.Default_Mgmt_Fee_Rate_Annual).not.toBe(
      ILLUSTRATIVE_FUND.setup.Default_Mgmt_Fee_Rate_Annual,
    );
    expect(model.setup.Org_Expense_Cap).not.toBe(ILLUSTRATIVE_FUND.setup.Org_Expense_Cap);
    expect(model.setup.Rounding_Plug_LP_ID).not.toBe(
      ILLUSTRATIVE_FUND.setup.Rounding_Plug_LP_ID,
    );
    expect(model.fee.Default_Fee_Rate_Annual).not.toBe(
      ILLUSTRATIVE_FUND.fee.Default_Fee_Rate_Annual,
    );
  });

  it('starts with no register, components, transfers or fixture', () => {
    expect(model.lps).toEqual([]);
    expect(model.components).toEqual([]);
    expect(model.transfers).toEqual([]);
    expect(model.fee.offsets).toEqual([]);
    expect(model.golden).toBeNull();
  });

  it('computes without throwing, and charges nobody anything', () => {
    const result = compute(model);
    expect(result.rows).toEqual([]);
    expect(result.totals.total).toBe(0);
    // An unset rounding policy means cents, not whole units.
    expect(result.d).toBe(2);
  });
});

describe('an incomplete call cannot be issued', () => {
  it('fails on the dates an investor would need', () => {
    const texts = compute(emptyCall('Some Fund, L.P.'))
      .checks.filter((c) => c.level === 'fail')
      .map((c) => c.text);

    expect(texts).toContain('Call_Date is not set.');
    expect(texts.some((t) => t.includes('Payment_Due_Date'))).toBe(true);
  });

  it('blocks approval while a date is missing', () => {
    expect(canApprove(compute(emptyCall('Some Fund, L.P.')).checks).ok).toBe(false);
  });

  it('warns rather than fails on an unset currency', () => {
    const model = emptyCall('Some Fund, L.P.');
    model.setup.Call_Date = '2026-09-30';
    model.setup.Payment_Due_Date = '2026-10-14';

    const checks = compute(model).checks;
    expect(checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(checks.some((c) => c.level === 'warn' && c.text.includes('Reporting_Currency'))).toBe(
      true,
    );
    // Warnings are the accountant's call, so this one may still be approved.
    expect(canApprove(checks).ok).toBe(true);
  });

  it('says so when the fund has no name', () => {
    const texts = compute(emptyCall('')).checks.map((c) => c.text);
    expect(texts.some((t) => t.includes('Fund_Name'))).toBe(true);
  });

  it('stops complaining once the call is filled in', () => {
    const checks = compute(ILLUSTRATIVE_FUND).checks;
    expect(checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(checks.some((c) => c.text.includes('is not set'))).toBe(false);
  });
});

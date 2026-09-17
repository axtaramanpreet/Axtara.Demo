/**
 * Carry-forward tests.
 *
 * Getting this wrong is expensive and quiet: if closing balances do not become
 * opening balances, every subsequent call draws against stale figures and the
 * fund over-calls its investors.
 */

import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { carryForwardRegister, nextCallFrom } from '@/engine/carry-forward';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';

describe('carrying a register forward', () => {
  const previous = compute(ILLUSTRATIVE_FUND);
  const carried = carryForwardRegister(ILLUSTRATIVE_FUND);

  it('opens each investor where the last call closed them', () => {
    previous.rows.forEach((row) => {
      const next = carried.find((l) => l.LP_ID === row.LP_ID)!;
      expect(next.Opening_Paid_In).toBeCloseTo(row.closingPaid, 2);
      expect(next.Opening_UCC).toBeCloseTo(row.closingUCC, 2);
    });
  });

  it('matches the accountant’s Expected_Output closing figures', () => {
    // LP01 closed at 3,393,719.91 paid in and 6,635,983.06 unfunded.
    const lp01 = carried.find((l) => l.LP_ID === 'LP01')!;
    expect(lp01.Opening_Paid_In).toBeCloseTo(3393719.91, 2);
    expect(lp01.Opening_UCC).toBeCloseTo(6635983.06, 2);
  });

  it('grows invested capital by deal allocations only', () => {
    const lp01 = carried.find((l) => l.LP_ID === 'LP01')!;
    // 1,800,000 opening + Deal X 594,059.41 + Deal Y 396,039.60 + Deal Z 294,840.29.
    // Partnership and organizational expense are called but not invested.
    expect(lp01.Opening_Invested_Capital).toBeCloseTo(3084939.3, 2);
  });

  it('keeps commitments, side letters and contact details', () => {
    const lp03 = carried.find((l) => l.LP_ID === 'LP03')!;
    expect(lp03.Commitment).toBe(5000000);
    expect(lp03.Mgmt_Fee_Rate_Override).toBe(0.01);
    expect(lp03.Side_Letter_Ref).toBe('SL-2024-03');
    expect(lp03.Contact_Email).toBe('ops@gammafo.example');
    expect(carried.find((l) => l.LP_ID === 'GP01')!.Fee_Exempt).toBe('Y');
  });

  it('carries investors who arrived through a transfer', () => {
    const withTransfer = structuredClone(ILLUSTRATIVE_FUND);
    withTransfer.transfers[0].Effective_Date = '2026-06-30';

    const next = carryForwardRegister(withTransfer);
    expect(next.map((l) => l.LP_ID)).toContain('LP06');
  });

  it('keeps a fully transferred investor out of the next call', () => {
    const fullTransfer = structuredClone(ILLUSTRATIVE_FUND);
    fullTransfer.transfers[0].Effective_Date = '2026-06-30';
    fullTransfer.transfers[0].Transfer_Type = 'Full';

    const next = carryForwardRegister(fullTransfer);
    expect(next.find((l) => l.LP_ID === 'LP05')!.Status).toBe('Transferred');
  });

  it('adds up: the fund’s closing position is its next opening position', () => {
    const openPaid = carried.reduce((s, l) => s + Number(l.Opening_Paid_In), 0);
    const openUCC = carried.reduce((s, l) => s + Number(l.Opening_UCC), 0);
    expect(openPaid).toBeCloseTo(previous.totals.closingPaid, 2);
    expect(openUCC).toBeCloseTo(previous.totals.closingUCC, 2);
  });
});

describe('seeding the next call', () => {
  const next = nextCallFrom(ILLUSTRATIVE_FUND);

  it('increments the call number and clears its dates', () => {
    expect(next.setup.Call_Number).toBe(3);
    expect(next.setup.Call_Date).toBe('');
    expect(next.setup.Payment_Due_Date).toBe('');
  });

  it('keeps the fee configuration but drops spent offsets', () => {
    expect(next.fee.Default_Fee_Rate_Annual).toBe(0.02);
    expect(next.fee.Fee_Exempt_LP_IDs).toBe('GP01');
    expect(next.fee.offsets).toEqual([]);
  });

  it('starts with no components and no transfers', () => {
    // What is being called for is the one thing different every call, and a
    // transfer must be re-entered rather than silently reapplied.
    expect(next.components).toEqual([]);
    expect(next.transfers).toEqual([]);
  });

  it('drops the previous call’s Expected_Output fixture', () => {
    // It belongs to the call it came from; keeping it would fail every check.
    expect(next.golden).toBeNull();
  });
});

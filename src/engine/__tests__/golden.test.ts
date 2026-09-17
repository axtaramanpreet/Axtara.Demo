/**
 * The golden regression test.
 *
 * The accountant's Expected_Output tab is the contract: if the engine and that
 * tab disagree by so much as a cent, this fails. Everything else in the product
 * is downstream of these numbers being right.
 */

import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';

describe('Expected_Output golden fixture', () => {
  const result = compute(ILLUSTRATIVE_FUND);

  it('matches every figure in the accountant’s Expected_Output tab', () => {
    expect(result.goldenDiffs).toEqual([]);
  });

  it('reports the fixture match as a passing check', () => {
    const check = result.checks.find((c) => c.text.startsWith('Expected_Output fixture'));
    expect(check?.level).toBe('ok');
  });

  it('raises no failing checks', () => {
    expect(result.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('calls the total the workbook expects', () => {
    // Expected_Output totals row: 7,037,500.00 across all investors.
    expect(result.totals.total).toBeCloseTo(7037500, 2);
    expect(result.totals.reduces).toBeCloseTo(6887500, 2);
  });

  it('ties every component allocation to the amount called', () => {
    ILLUSTRATIVE_FUND.components.forEach((c, i) => {
      expect(result.totals.comps[i]).toBeCloseTo(Number(c.Total_Amount), 2);
    });
  });

  it('rolls unfunded and paid-in forward consistently', () => {
    expect(result.totals.closingUCC).toBeCloseTo(result.totals.openUCC - result.totals.reduces, 2);
    expect(result.totals.closingPaid).toBeCloseTo(result.totals.openPaid + result.totals.total, 2);
  });

  it('nets the fee down by the offset', () => {
    expect(result.fee.grossTotal).toBeCloseTo(237500, 2);
    expect(result.fee.offsetTotal).toBeCloseTo(50000, 2);
    expect(result.totals.feeNet).toBeCloseTo(187500, 2);
  });

  it('charges the side-letter LP its overridden rate and exempts the GP', () => {
    const lp03 = result.rows.find((r) => r.LP_ID === 'LP03');
    const gp01 = result.rows.find((r) => r.LP_ID === 'GP01');
    expect(lp03?.feeRate).toBe(0.01);
    expect(gp01?.feeRate).toBe(0);
    expect(gp01?.feeGross).toBe(0);
  });

  it('does not apply a transfer dated after the call date', () => {
    expect(result.transfers.applied).toHaveLength(0);
    expect(result.transfers.skipped).toHaveLength(1);
    expect(result.roster.find((l) => l.LP_ID === 'LP06')).toBeUndefined();
  });
});

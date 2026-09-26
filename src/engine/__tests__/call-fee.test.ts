import { describe, expect, it } from 'vitest';
import { callFeePeriod, feeAlreadyCharged } from '../call-fee';
import { compute } from '../compute';
import { ILLUSTRATIVE_FUND } from '../fixtures/illustrative-fund';
import { issuedCallFrom } from '../positions';

const call1 = issuedCallFrom(1, '2026-02-10', '2026-02-24', compute(structuredClone(ILLUSTRATIVE_FUND)).rows);

describe('the period a call’s fee covers', () => {
  it('is the fee period its date falls in', () => {
    expect(callFeePeriod('2026-02-10', 0.25)).toEqual({ from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026' });
    expect(callFeePeriod('2026-08-01', 0.5)?.label).toBe('H2 2026');
    expect(callFeePeriod('', 0.25)).toBeNull();
  });
});

describe('a second call in the same period', () => {
  const q1 = callFeePeriod('2026-03-20', 0.25)!;

  it('finds the earlier call that already charged the period’s fee, and how much', () => {
    // The illustrative call charges 237,500 of fee, less a 50,000 offset: 187,500.
    expect(feeAlreadyCharged([call1], q1, 2)).toEqual([{ callNo: 1, callDate: '2026-02-10', fee: 187_500 }]);
  });

  it('ignores the call itself, calls in other periods, and calls that charged no fee', () => {
    expect(feeAlreadyCharged([call1], q1, 1)).toEqual([]);
    expect(feeAlreadyCharged([call1], callFeePeriod('2026-04-02', 0.25)!, 2)).toEqual([]);
    const noFee = { ...call1, lines: call1.lines.map((l) => ({ ...l, total: l.capital })) };
    expect(feeAlreadyCharged([noFee], q1, 2)).toEqual([]);
  });
});

describe('a call that leaves the fee out', () => {
  it('charges no fee, says so, and still ties', () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.setup.Charge_Mgmt_Fee = 'N';
    const r = compute(model);
    expect(r.totals.feeGross).toBe(0);
    expect(r.checks.some((c) => c.text === 'The management fee is not charged on this call.')).toBe(true);
    // Its offset goes with the fee it would have reduced.
    expect(r.totals.feeOffset).toBe(0);
    expect(r.checks.some((c) => c.text === 'Its 1 fee offset is left out with it.')).toBe(true);
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });
});

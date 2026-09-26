/**
 * The management fee as its own calculation.
 *
 * Every expected figure below is worked out by hand in the comment beside it,
 * so a failure says which arithmetic moved, not just that something did.
 */

import { describe, expect, it } from 'vitest';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import { feeForRange, trueUp, type FeeInvestor } from '../fee-run';

const terms = (patch: Partial<FundTerms>): FundTerms => ({
  ...BLANK_TERMS,
  effectiveFrom: '2024-01-01',
  createdAt: '2024-01-02T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  ...patch,
});

const lp = (lpId: string, amount: number, from = '2024-01-01', patch: Partial<FeeInvestor> = {}): FeeInvestor => ({
  lpId,
  name: lpId,
  commitments: [{ from, amount }],
  ...patch,
});

const Q3 = ['2026-07-01', '2026-09-30'] as const; // 92 days

describe('a full quarter', () => {
  it('is commitment × rate × the period fraction', () => {
    // 10,000,000 × 0.02 × 0.25 = 50,000 — the same as the call engine charges.
    const r = feeForRange(...Q3, [terms({})], [lp('LP01', 10_000_000)]);
    expect(r.lines[0].fee).toBe(50_000);
    expect(r.lines[0].slices).toHaveLength(1);
    expect(r.lines[0].slices[0].fractionWorking).toBe('0.25');
  });

  it('follows the day count the fund has set', () => {
    // Actual/365: 10,000,000 × 0.02 × 92/365 = 50,410.958… → 50,410.96
    expect(feeForRange(...Q3, [terms({ feeDayCount: 'actual_365' })], [lp('LP01', 10_000_000)]).lines[0].fee).toBe(50_410.96);
    // Actual/360: × 92/360 = 51,111.11
    expect(feeForRange(...Q3, [terms({ feeDayCount: 'actual_360' })], [lp('LP01', 10_000_000)]).lines[0].fee).toBe(51_111.11);
    // 30/360: a quarter is always 90/360 = 0.25 → 50,000
    expect(feeForRange(...Q3, [terms({ feeDayCount: '30_360' })], [lp('LP01', 10_000_000)]).lines[0].fee).toBe(50_000);
  });
});

describe('someone who joins part-way through', () => {
  it('pays only for the days they were in', () => {
    // In from 15 August: 15 Aug – 30 Sep is 47 of Q3's 92 days.
    // 10,000,000 × 0.02 × 0.25 × 47/92 = 25,543.478… → 25,543.48
    const r = feeForRange(...Q3, [terms({})], [lp('LP01', 5_000_000), lp('LP07', 10_000_000, '2026-08-15')]);
    const late = r.lines.find((l) => l.lpId === 'LP07')!;
    expect(late.fee).toBe(25_543.48);
    // Before joining, their basis was nil, so that slice charged nothing.
    expect(late.slices[0]).toMatchObject({ from: '2026-07-01', to: '2026-08-14', basis: 0, amount: 0 });
    expect(late.slices[1]).toMatchObject({ from: '2026-08-15', to: '2026-09-30', days: 47, fractionWorking: '0.25 × 47/92' });
    // Everyone else is unaffected: their two slices add back to a full quarter.
    expect(r.lines.find((l) => l.lpId === 'LP01')!.fee).toBe(25_000);
  });

  it('pays on the new amount from the day a commitment grows', () => {
    // 5m all quarter, plus 5m more from 15 August:
    // 5m × 0.005 + 5m × 0.005 × 47/92 = 25,000 + 12,771.74 = 37,771.74
    const grows = lp('LP01', 5_000_000, '2024-01-01', {
      commitments: [
        { from: '2024-01-01', amount: 5_000_000 },
        { from: '2026-08-15', amount: 5_000_000 },
      ],
    });
    expect(feeForRange(...Q3, [terms({})], [grows]).lines[0].fee).toBe(37_771.74);
  });
});

describe('a step-down after the investment period', () => {
  const history = [
    terms({}),
    terms({ effectiveFrom: '2026-08-01', feeBasis: 'Invested_Capital', feeRateAnnual: 0.015 }),
  ];
  const investor = lp('LP01', 10_000_000, '2024-01-01', { invested: [{ from: '2024-01-01', amount: 4_000_000 }] });

  it('charges the old terms up to the change and the new ones after it', () => {
    // 1 Jul – 31 Jul: 31/92 on commitment at 2%:      10m × 0.02 × 0.25 × 31/92 = 16,847.83
    // 1 Aug – 30 Sep: 61/92 on invested capital at 1.5%: 4m × 0.015 × 0.25 × 61/92 =  9,945.65
    //                                                                         total 26,793.48
    const line = feeForRange(...Q3, history, [investor]).lines[0];
    expect(line.slices.map((s) => [s.basisKind, s.basis, s.rate])).toEqual([
      ['Commitment', 10_000_000, 0.02],
      ['Invested_Capital', 4_000_000, 0.015],
    ]);
    expect(line.fee).toBe(26_793.48);
  });

  it('says where it split the period, and why', () => {
    const notes = feeForRange(...Q3, history, [investor]).notes;
    expect(notes.some((n) => n.text.includes('split on 1 August 2026'))).toBe(true);
  });
});

describe('who pays nothing, or less', () => {
  it('charges nothing to someone exempt, by flag or by the fund’s list', () => {
    const r = feeForRange(...Q3, [terms({ feeExemptLpIds: ['GP01'] })], [
      lp('GP01', 500_000),
      lp('LP09', 1_000_000, '2024-01-01', { feeExempt: true }),
    ]);
    expect(r.lines.map((l) => [l.lpId, l.fee, l.exempt])).toEqual([
      ['GP01', 0, true],
      ['LP09', 0, true],
    ]);
  });

  it('applies a side-letter rate, and treats a zero one as no override', () => {
    // 1% by side letter: 5,000,000 × 0.01 × 0.25 = 12,500
    const r = feeForRange(...Q3, [terms({})], [
      lp('LP03', 5_000_000, '2024-01-01', { feeRateOverride: 0.01 }),
      lp('LP04', 5_000_000, '2024-01-01', { feeRateOverride: 0 }),
    ]);
    expect(r.lines[0].fee).toBe(12_500);
    expect(r.lines[1].fee).toBe(25_000);
  });
});

describe('a range across several periods', () => {
  it('adds up each period, pro-rating only the part one', () => {
    // 1 Jan – 14 Aug 2026 on 10m at 2%: Q1 0.25 + Q2 0.25 + Q3 0.25 × 45/92
    // = 10m × 0.02 × (0.5 + 0.12228…) = 124,456.52
    const line = feeForRange('2026-01-01', '2026-08-14', [terms({})], [lp('LP07', 10_000_000)]).lines[0];
    expect(line.slices.map((s) => s.fractionWorking)).toEqual(['0.25', '0.25', '0.25 × 45/92']);
    expect(line.fee).toBe(124_456.52);
  });
});

describe('a fund with no terms', () => {
  it('charges nothing, and says so', () => {
    const r = feeForRange(...Q3, [], [lp('LP01', 10_000_000)]);
    expect(r.total).toBe(0);
    expect(r.notes[0]).toMatchObject({ level: 'warn' });
  });
});

describe('a true-up', () => {
  it('keeps what was charged and what should have been, not just the difference', () => {
    // Charged on 10m for the quarter; the investor had grown to 10.35m from the start.
    // Should have been 10,350,000 × 0.005 = 51,750 → true-up 1,750.
    const now = feeForRange(...Q3, [terms({})], [lp('LP01', 10_350_000)]);
    const [line] = trueUp([{ lpId: 'LP01', name: 'LP01', fee: 50_000 }], now);
    expect(line).toEqual({ lpId: 'LP01', name: 'LP01', charged: 50_000, shouldHave: 51_750, trueUp: 1_750 });
  });

  it('covers someone charged before who should not have been, and someone new', () => {
    const now = feeForRange(...Q3, [terms({})], [lp('LP07', 10_000_000, '2026-08-15')]);
    const lines = trueUp([{ lpId: 'LP99', name: 'Gone', fee: 1_000 }], now);
    expect(lines.find((l) => l.lpId === 'LP99')).toMatchObject({ charged: 1_000, shouldHave: 0, trueUp: -1_000 });
    expect(lines.find((l) => l.lpId === 'LP07')).toMatchObject({ charged: 0, shouldHave: 25_543.48, trueUp: 25_543.48 });
  });
});

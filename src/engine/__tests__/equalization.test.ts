/**
 * Equalization at a later close.
 *
 * One small fund, worked end to end by hand (the arithmetic is in the comments
 * and was checked separately before these were written):
 *
 *   First close 1 Jan 2026:   LP01 6,000,000   LP02 4,000,000        T = 10m
 *   Call 1, due 15 Feb 2026:  1,000,000 capital (all against commitment)
 *   Call 2, due 15 May 2026:  2,000,000 capital, 1,800,000 against commitment
 *   Second close 1 Aug 2026:  LP07 5,000,000                         N = 5m
 *   Terms: 2% on commitment, 0.25 a quarter; 8% late-close interest.
 */

import { describe, expect, it } from 'vitest';
import { equalize, type EqualizationInput, type PriorCall } from '../equalization';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';

const terms = (patch: Partial<FundTerms> = {}): FundTerms => ({
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  lateCloseInterestRate: 0.08,
  lateCloseInterestBasis: 'simple',
  equalizationInterestTo: 'existing_lps',
  catchUpFeeTo: 'gp',
  ...patch,
});

const call1: PriorCall = {
  callNo: 1,
  dueDate: '2026-02-15',
  lines: [
    { lpId: 'LP01', capital: 600_000, inside: 600_000 },
    { lpId: 'LP02', capital: 400_000, inside: 400_000 },
  ],
};
const call2: PriorCall = {
  callNo: 2,
  dueDate: '2026-05-15',
  lines: [
    { lpId: 'LP01', capital: 1_200_000, inside: 1_080_000 },
    { lpId: 'LP02', capital: 800_000, inside: 720_000 },
  ],
};

const base = (patch: Partial<EqualizationInput> = {}): EqualizationInput => ({
  closingDate: '2026-08-01',
  feeStart: '2026-01-01',
  existing: [
    { lpId: 'LP01', name: 'Alpha Pension Trust', commitment: 6_000_000 },
    { lpId: 'LP02', name: 'Beta Endowment', commitment: 4_000_000 },
  ],
  newcomers: [{ lpId: 'LP07', name: 'Eta Capital', commitment: 5_000_000 }],
  priorCalls: [call1, call2],
  terms: [terms()],
  ...patch,
});

const lineOf = (r: ReturnType<typeof equalize>, lpId: string) => r.lines.find((l) => l.lpId === lpId)!;

describe('the late investor', () => {
  const r = equalize(base());
  const late = lineOf(r, 'LP07');

  it('pays their commitment’s share of every earlier call', () => {
    // Call 1: 1,000,000 × 5/15 = 333,333.33   Call 2: 2,000,000 × 5/15 = 666,666.67
    expect(late.calls.map((c) => [c.callNo, c.capital])).toEqual([
      [1, 333_333.33],
      [2, 666_666.67],
    ]);
    expect(late.capital).toBe(1_000_000);
  });

  it('draws down unfunded by the part that counted against commitment', () => {
    // Call 1 all inside: 333,333.33   Call 2: 666,666.67 × 1.8/2.0 = 600,000.00
    expect(late.inside).toBe(933_333.33);
  });

  it('pays interest on each call separately, from its due date', () => {
    // Call 1: 15 Feb → 1 Aug = 167 days: 333,333.33 × 8% × 167/365 = 12,200.91
    // Call 2: 15 May → 1 Aug =  78 days: 666,666.67 × 8% ×  78/365 = 11,397.26
    expect(late.calls.map((c) => [c.days, c.interest])).toEqual([
      [167, 12_200.91],
      [78, 11_397.26],
    ]);
    expect(late.interest).toBe(23_598.17);
  });

  it('pays the management fee they missed since the first close', () => {
    // 1 Jan – 31 Jul on 5,000,000 at 2%: Q1 0.25 + Q2 0.25 + Q3 0.25 × 31/92
    // = 100,000 × 0.584239… = 58,423.91
    expect(late.catchUpFee).toBe(58_423.91);
    expect(late.feeSlices.map((s) => s.fractionWorking)).toEqual(['0.25', '0.25', '0.25 × 31/92']);
  });

  it('owes the three together', () => {
    // 1,000,000 + 23,598.17 + 58,423.91 = 1,082,022.08
    expect(late.net).toBe(1_082_022.08);
  });
});

describe('the earlier investors', () => {
  const r = equalize(base());

  it('get back what the late investor paid, in proportion to what each paid into each call', () => {
    // Call 1: 333,333.33 split 600:400 → LP02 133,333.33, LP01 the rest 200,000.00
    // Call 2: 666,666.67 split 1.2:0.8 → LP02 266,666.67, LP01 the rest 400,000.00
    expect(lineOf(r, 'LP01').capital).toBe(-600_000);
    expect(lineOf(r, 'LP02').capital).toBe(-400_000);
  });

  it('receive the interest, split the same way', () => {
    // Call 1 interest 12,200.91 → LP02 4,880.36, LP01 7,320.55
    // Call 2 interest 11,397.26 → LP02 4,558.90, LP01 6,838.36
    expect(lineOf(r, 'LP01').interest).toBe(-14_158.91);
    expect(lineOf(r, 'LP02').interest).toBe(-9_439.26);
  });

  it('are not charged the catch-up fee when it goes to the general partner', () => {
    expect(lineOf(r, 'LP01').catchUpFee).toBe(0);
    expect(r.totals.feeToGp).toBe(58_423.91);
  });
});

describe('the proof', () => {
  const r = equalize(base());

  it('shows capital in equals capital out, to the cent', () => {
    const check = r.checks.find((c) => c.text.startsWith('Late investors pay'))!;
    expect(check.level).toBe('ok');
    expect(check.text).toBe('Late investors pay 1,000,000.00 of capital; earlier investors get 1,000,000.00 back.');
  });

  it('shows the late investor is now paid in to the same share as the fund', () => {
    // 3,000,000 called over 15,000,000 committed = 20.00%; LP07 1,000,000 / 5,000,000 = 20.00%
    expect(r.totals.paidInPct).toBeCloseTo(0.2, 10);
    expect(r.checks.find((c) => c.text.startsWith('LP07'))).toMatchObject({
      level: 'ok',
      text: 'LP07 has now paid in 20.00% of commitment, the same as the fund (20.00%).',
    });
  });

  it('fails nothing', () => {
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });
});

describe('what the fund’s terms change', () => {
  it('compounds interest when the LPA says so', () => {
    // 333,333.33 × (1.08^(167/365) − 1) = 11,946.54
    // 666,666.67 × (1.08^(78/365)  − 1) = 11,054.97
    const r = equalize(base({ terms: [terms({ lateCloseInterestBasis: 'compound' })] }));
    expect(lineOf(r, 'LP07').interest).toBe(23_001.51);
  });

  it('keeps interest in the fund, or pays it to the GP, instead of the earlier investors', () => {
    const fund = equalize(base({ terms: [terms({ equalizationInterestTo: 'fund' })] }));
    expect(lineOf(fund, 'LP01').interest).toBe(0);
    expect(fund.totals.interestToFund).toBe(23_598.17);
    const gp = equalize(base({ terms: [terms({ equalizationInterestTo: 'gp' })] }));
    expect(gp.totals.interestToGp).toBe(23_598.17);
    expect(gp.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('shares the catch-up fee among the earlier investors when the LPA says so', () => {
    // 58,423.91 split 6:4 → LP02 23,369.56, LP01 35,054.35
    const r = equalize(base({ terms: [terms({ catchUpFeeTo: 'existing_lps' })] }));
    expect(lineOf(r, 'LP01').catchUpFee).toBe(-35_054.35);
    expect(lineOf(r, 'LP02').catchUpFee).toBe(-23_369.56);
    expect(r.totals.feeToGp).toBe(0);
  });

  it('charges no interest when the terms set no rate', () => {
    const r = equalize(base({ terms: [terms({ lateCloseInterestRate: null })] }));
    expect(lineOf(r, 'LP07').interest).toBe(0);
    expect(r.checks.some((c) => c.text.startsWith('No late-close interest'))).toBe(true);
  });
});

describe('awkward cases', () => {
  it('refunds nothing for a call an investor was excused from', () => {
    // LP02 excused from call 2: all of call 2's 666,666.67 goes back to LP01.
    const excused: PriorCall = { ...call2, lines: [{ lpId: 'LP01', capital: 2_000_000, inside: 1_800_000 }] };
    const r = equalize(base({ priorCalls: [call1, excused] }));
    expect(lineOf(r, 'LP02').calls.map((c) => c.callNo)).toEqual([1]);
    expect(lineOf(r, 'LP01').capital).toBe(-866_666.67);
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('splits between several late investors by their commitments', () => {
    // N = 5m + 2.5m = 7.5m, T' = 17.5m. Call 1 moves 1,000,000 × 7.5/17.5 = 428,571.43,
    // split 2:1 → LP08 142,857.14, LP07 285,714.29.
    const r = equalize(
      base({
        newcomers: [
          { lpId: 'LP07', name: 'Eta', commitment: 5_000_000 },
          { lpId: 'LP08', name: 'Theta', commitment: 2_500_000 },
        ],
      }),
    );
    expect(lineOf(r, 'LP07').calls[0].capital).toBe(285_714.29);
    expect(lineOf(r, 'LP08').calls[0].capital).toBe(142_857.14);
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('handles an earlier investor who increases their commitment', () => {
    // LP01 adds 5m: they catch up on the increase and are refunded on the original.
    const r = equalize(base({ newcomers: [{ lpId: 'LP01', name: 'Alpha Pension Trust', commitment: 5_000_000 }] }));
    const lp01 = lineOf(r, 'LP01');
    expect(lp01.role).toBe('both');
    expect(lp01.commitment).toBe(11_000_000);
    // Pays 1,000,000 on the increase, gets 600,000 back on the original: nets 400,000.
    expect(lp01.capital).toBe(400_000);
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('moves no capital when nothing was called before the close', () => {
    const r = equalize(base({ priorCalls: [] }));
    expect(lineOf(r, 'LP07').capital).toBe(0);
    expect(lineOf(r, 'LP07').catchUpFee).toBe(58_423.91);
    expect(r.checks.some((c) => c.level === 'info' && c.text.includes('No calls were issued'))).toBe(true);
  });

  it('refuses to equalize a close that adds nobody', () => {
    const r = equalize(base({ newcomers: [] }));
    expect(r.checks.some((c) => c.level === 'fail' && c.text.includes('Nobody new'))).toBe(true);
  });

  it('charges no catch-up fee to an exempt late investor', () => {
    const r = equalize(base({ newcomers: [{ lpId: 'GP02', name: 'Co-GP', commitment: 5_000_000, feeExempt: true }] }));
    expect(lineOf(r, 'GP02').catchUpFee).toBe(0);
  });
});

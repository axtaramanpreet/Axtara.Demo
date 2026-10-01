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
import { equalize, equalizationRunTo, type EqualizationInput, type PriorCall } from '../equalization';
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

  it('pays interest on the catch-up fee, from the first close to their closing', () => {
    // The fund manager's rule: 58,423.91 × 8% × 212/365 (1 Jan → 1 Aug) = 2,714.71
    expect(late.feeInterest).toBe(2_714.71);
    expect(r.totals.feeInterest).toBe(2_714.71);
    expect(r.totals.feeInterestToGp).toBe(2_714.71);
  });

  it('owes the four together', () => {
    // 1,000,000 + 23,598.17 + 58,423.91 + 2,714.71 = 1,084,736.79
    expect(late.net).toBe(1_084_736.79);
  });

  it('records where the capital interest stops, the fund manager’s rule when blank', () => {
    expect(r.totals.interestUntil).toBe('collection_due_date');
    expect(r.totals.catchUpFeeInterest).toBe('first_close');
  });
});

describe('interest on the catch-up fee, the other ways', () => {
  it('per period: each period’s part from that period’s start', () => {
    // Q1 25,000 × 8% × 212/365 = 1,161.64   Q2 25,000 × 8% × 122/365 = 668.49
    // Q3 8,423.91 × 8% × 31/365 = 57.24                     total 1,887.37
    const late = lineOf(equalize(base({ terms: [terms({ catchUpFeeInterest: 'per_period' })] })), 'LP07');
    expect(late.feeInterest).toBe(1_887.37);
  });

  it('none: no interest on the fee', () => {
    const late = lineOf(equalize(base({ terms: [terms({ catchUpFeeInterest: 'none' })] })), 'LP07');
    expect(late.feeInterest).toBe(0);
    expect(late.net).toBe(1_082_022.08);
  });

  it('goes where the fee goes: shared by commitment when the earlier investors get the fee', () => {
    // 2,714.71 split 6:4 → LP01 1,628.83, LP02 1,085.88
    const r = equalize(base({ terms: [terms({ catchUpFeeTo: 'existing_lps' })] }));
    expect(lineOf(r, 'LP01').feeInterest).toBe(-1_628.83);
    expect(lineOf(r, 'LP02').feeInterest).toBe(-1_085.88);
    expect(r.totals.feeInterestToGp).toBe(0);
  });
});

describe('interest on the catch-up fee at a rate of its own', () => {
  it('uses it on the fee, and leaves the capital interest at the late-close rate', () => {
    // 58,423.91 × 5% × 212/365 = 1,696.69; capital interest stays 23,598.17 at 8%
    const late = lineOf(equalize(base({ terms: [terms({ catchUpFeeInterestRate: 0.05 })] })), 'LP07');
    expect(late.feeInterest).toBe(1_696.69);
    expect(late.interest).toBe(23_598.17);
  });

  it('charges it even with no late-close rate', () => {
    const r = equalize(base({ terms: [terms({ lateCloseInterestRate: null, catchUpFeeInterestRate: 0.05 })] }));
    expect(lineOf(r, 'LP07').interest).toBe(0);
    expect(lineOf(r, 'LP07').feeInterest).toBe(1_696.69);
    expect(r.totals.feeInterestRate).toBe(0.05);
  });

  it('blank uses the late-close rate', () => {
    const r = equalize(base());
    expect(lineOf(r, 'LP07').feeInterest).toBe(2_714.71);
    expect(r.totals.feeInterestRate).toBe(0.08);
  });
});

describe('capital interest run to a later date', () => {
  const r = equalize(base());
  const later = equalizationRunTo(r, '2026-09-01');
  const lineIn = (x: typeof r, id: string) => x.lines.find((l) => l.lpId === id)!;

  it('is the same calculation, to the collecting call’s due date', () => {
    // To 1 Sep: call 1 198 days, call 2 109 days
    // 333,333.33 × 8% × 198/365 = 14,465.75   666,666.67 × 8% × 109/365 = 15,926.94
    expect(lineIn(later, 'LP07').calls.map((c) => [c.days, c.interest])).toEqual([
      [198, 14_465.75],
      [109, 15_926.94],
    ]);
    expect(lineIn(later, 'LP07').interest).toBe(30_392.69);
    expect(round2(lineIn(later, 'LP01').interest + lineIn(later, 'LP02').interest)).toBe(-30_392.69);
    expect(later.totals).toMatchObject({ interest: 30_392.69, interestRunTo: '2026-09-01' });
  });

  it('leaves capital and the catch-up fee as finalised, and the net follows the interest', () => {
    const [a, b] = [lineIn(r, 'LP07'), lineIn(later, 'LP07')];
    expect([b.capital, b.inside, b.catchUpFee, b.feeInterest]).toEqual([a.capital, a.inside, a.catchUpFee, a.feeInterest]);
    // 1,000,000 + 30,392.69 + 58,423.91 + 2,714.71 = 1,091,531.31
    expect(b.net).toBe(1_091_531.31);
  });

  it('on or before the closing date gives back what finalising worked out', () => {
    expect(equalizationRunTo(r, '2026-08-01')).toBe(r);
  });
});

const round2 = (x: number) => Math.round(x * 100) / 100;

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

describe('the interest split, where a cent is left over', () => {
  // Three earlier investors, 1m each, paid 100,000 each into call 1 (due 15 Feb).
  // LP07 (1m) closes 2 Aug: share 300,000 × 1/4 = 75,000; 168 days at 8%:
  // 75,000 × 8% × 168/365 = 2,761.64, a third each = 920.5479… → 920.55, 920.55,
  // and the first of the equal shares takes the rest: 2,761.64 − 1,841.10 = 920.54.
  const input = base({
    closingDate: '2026-08-02',
    existing: ['LP01', 'LP02', 'LP03'].map((lpId) => ({ lpId, name: lpId, commitment: 1_000_000 })),
    newcomers: [{ lpId: 'LP07', name: 'Eta', commitment: 1_000_000 }],
    priorCalls: [{ callNo: 1, dueDate: '2026-02-15', lines: ['LP01', 'LP02', 'LP03'].map((lpId) => ({ lpId, capital: 100_000, inside: 100_000 })) }],
    terms: [terms({ catchUpFeeInterest: 'none', feeRateAnnual: null })],
  });
  const r = equalize(input);

  it('gives the leftover cent to the plug at finalising', () => {
    expect(lineOf(r, 'LP07').interest).toBe(2_761.64);
    expect(['LP01', 'LP02', 'LP03'].map((id) => lineOf(r, id).interest)).toEqual([-920.54, -920.55, -920.55]);
  });

  it('and the same way when it is worked out again to a later date', () => {
    // Worked again a day on, to 3 Aug: 75,000 × 8% × 169/365 = 2,778.08, a third
    // 926.03 each, and the first takes 2,778.08 − 1,852.06 = 926.02.
    const next = equalizationRunTo(r, '2026-08-03');
    expect(['LP01', 'LP02', 'LP03', 'LP07'].map((id) => next.lines.find((l) => l.lpId === id)!.interest)).toEqual([-926.02, -926.03, -926.03, 2_778.08]);
  });
});

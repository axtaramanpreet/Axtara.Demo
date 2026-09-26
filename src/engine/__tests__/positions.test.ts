/**
 * Where each investor stands, added up from what the fund has done.
 *
 * The same fund as equalization.test.ts: two investors at the first close, two
 * calls, a late investor at the second close. Here the question is what each
 * of them has paid in and still owes afterwards — the opening balances the
 * next call should start from.
 */

import { describe, expect, it } from 'vitest';
import { equalize } from '../equalization';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import { positionsAsOf, type IssuedCall } from '../positions';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  feeReducesUnfunded: true,
  lateCloseInterestRate: 0.08,
  equalizationInterestTo: 'existing_lps',
  catchUpFeeTo: 'gp',
};

// Call 1: 1,000,000, all for a deal. Call 2: 2,000,000, of which 1,800,000 a deal
// against commitment and 200,000 organizational expense outside it.
const call1: IssuedCall = {
  callNo: 1,
  callDate: '2026-02-01',
  dueDate: '2026-02-15',
  lines: [
    { lpId: 'LP01', name: 'Alpha', commitment: 6e6, openPaid: 0, openUnfunded: 6e6, openInvested: 0, total: 600_000, reduces: 600_000, capital: 600_000, inside: 600_000, deal: 600_000 },
    { lpId: 'LP02', name: 'Beta', commitment: 4e6, openPaid: 0, openUnfunded: 4e6, openInvested: 0, total: 400_000, reduces: 400_000, capital: 400_000, inside: 400_000, deal: 400_000 },
  ],
};
const call2: IssuedCall = {
  callNo: 2,
  callDate: '2026-05-01',
  dueDate: '2026-05-15',
  lines: [
    { lpId: 'LP01', name: 'Alpha', commitment: 6e6, openPaid: 600_000, openUnfunded: 5_400_000, openInvested: 600_000, total: 1_200_000, reduces: 1_080_000, capital: 1_200_000, inside: 1_080_000, deal: 1_080_000 },
    { lpId: 'LP02', name: 'Beta', commitment: 4e6, openPaid: 400_000, openUnfunded: 3_600_000, openInvested: 400_000, total: 800_000, reduces: 720_000, capital: 800_000, inside: 720_000, deal: 720_000 },
  ],
};

const eq = equalize({
  closingDate: '2026-08-01',
  feeStart: '2026-01-01',
  existing: [
    { lpId: 'LP01', name: 'Alpha', commitment: 6e6 },
    { lpId: 'LP02', name: 'Beta', commitment: 4e6 },
  ],
  newcomers: [{ lpId: 'LP07', name: 'Eta', commitment: 5e6 }],
  priorCalls: [call1, call2].map((c) => ({
    callNo: c.callNo,
    dueDate: c.dueDate,
    lines: c.lines.map((l) => ({ lpId: l.lpId, capital: l.capital, inside: l.inside })),
  })),
  terms: [terms],
});

const commitments = {
  LP01: { name: 'Alpha', changes: [{ from: '2026-01-01', amount: 6e6 }] },
  LP02: { name: 'Beta', changes: [{ from: '2026-01-01', amount: 4e6 }] },
  LP07: { name: 'Eta', changes: [{ from: '2026-08-01', amount: 5e6 }] },
};

const after = positionsAsOf('2026-09-01', {
  calls: [call1, call2],
  equalizations: [{ closingDate: '2026-08-01', lines: eq.lines, feeReducesUnfunded: true }],
  commitments,
});
const of = (lpId: string) => after.find((p) => p.lpId === lpId)!;

describe('after the second close', () => {
  it('puts the late investor where they would be had they joined at the start', () => {
    // Paid in: 1,000,000 capital + 58,423.91 catch-up fee = 1,058,423.91
    // Drawn:   933,333.33 against commitment + 58,423.91 fee = 991,757.24
    // Unfunded: 5,000,000 − 991,757.24 = 4,008,242.76
    // Invested: 333,333.33 × 100% deal + 666,666.67 × 90% deal = 933,333.33
    expect(of('LP07')).toEqual({
      lpId: 'LP07',
      name: 'Eta',
      commitment: 5e6,
      paidIn: 1_058_423.91,
      unfunded: 4_008_242.76,
      invested: 933_333.33,
    });
  });

  it('gives the earlier investors their refund back as unfunded commitment', () => {
    // LP01 paid 1,800,000, got 600,000 back → 1,200,000 paid in.
    // Drawn 1,680,000 against commitment, 560,000 of it refunded → 1,120,000.
    // Unfunded: 6,000,000 − 1,120,000 = 4,880,000
    expect(of('LP01')).toMatchObject({ paidIn: 1_200_000, unfunded: 4_880_000, invested: 1_120_000 });
    // LP02: drawn 1,120,000 − 373,333.33 refunded = 746,666.67 → unfunded 3,253,333.33
    expect(of('LP02')).toMatchObject({ paidIn: 800_000, unfunded: 3_253_333.33 });
  });

  it('adds up across the fund: nothing created, nothing lost', () => {
    // Commitments 15,000,000 − 2,800,000 drawn by calls − 58,423.91 catch-up fee
    const unfunded = after.reduce((s, p) => s + p.unfunded, 0);
    expect(Math.round(unfunded * 100) / 100).toBe(12_141_576.09);
    // Capital paid in is the 3,000,000 called plus the fee: moving it changed no total.
    const paid = after.reduce((s, p) => s + p.paidIn, 0);
    expect(Math.round(paid * 100) / 100).toBe(3_058_423.91);
  });
});

describe('on other dates', () => {
  it('knows nothing of the late investor before they joined', () => {
    const before = positionsAsOf('2026-07-31', {
      calls: [call1, call2],
      equalizations: [{ closingDate: '2026-08-01', lines: eq.lines, feeReducesUnfunded: true }],
      commitments,
    });
    expect(before.map((p) => p.lpId)).toEqual(['LP01', 'LP02']);
    expect(before.find((p) => p.lpId === 'LP01')).toMatchObject({ paidIn: 1_800_000, unfunded: 4_320_000 });
  });

  it('shows someone admitted with nothing called yet as fully unfunded', () => {
    const early = positionsAsOf('2026-01-15', { calls: [call1, call2], commitments });
    expect(early.find((p) => p.lpId === 'LP01')).toMatchObject({ commitment: 6e6, paidIn: 0, unfunded: 6e6 });
  });
});

describe('a fund that came from a workbook', () => {
  it('starts from the first call’s own opening balances, and uses its commitments', () => {
    const imported: IssuedCall = {
      ...call1,
      lines: [{ ...call1.lines[0], openPaid: 2e6, openUnfunded: 4e6, openInvested: 1.8e6 }],
    };
    const [p] = positionsAsOf('2026-03-01', { calls: [imported] });
    // Paid 2,000,000 before Axtara, 600,000 since. Drawn 2,000,000 + 600,000 of 6,000,000.
    expect(p).toMatchObject({ commitment: 6e6, paidIn: 2_600_000, unfunded: 3_400_000, invested: 2_400_000 });
  });
});

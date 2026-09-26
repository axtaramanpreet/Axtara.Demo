/**
 * One investor's capital account ends where the fund says they stand.
 *
 * The account and `positionsOn` are built separately — one entry by entry, the
 * other in one sum — so this is the check that neither drifted.
 */

import { describe, expect, it } from 'vitest';
import { capitalAccount } from '../capital-account';
import { compute } from '../compute';
import { equalize } from '../equalization';
import { equalizationInputFor, positionsOn, type ClosingRecord, type FundHistory } from '../fund-history';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import { issuedCallFrom } from '../positions';
import { ILLUSTRATIVE_FUND } from '../fixtures/illustrative-fund';

const model = structuredClone(ILLUSTRATIVE_FUND);
const call1 = issuedCallFrom(1, '2026-09-30', '2026-10-14', compute(model).rows);
const terms: FundTerms = { ...BLANK_TERMS, effectiveFrom: '2024-01-01', createdAt: '', feeBasis: 'Commitment', feeRateAnnual: 0.02, feePeriodFraction: 0.25, lateCloseInterestRate: 0.08, feeReducesUnfunded: true };
const first: ClosingRecord = {
  id: 'c1', closingNo: 1, closingDate: '2024-01-01', finalised: true, result: null,
  commitments: model.lps.map((l) => ({ lpId: l.LP_ID, name: l.LP_Name, amount: Number(l.Commitment), feeRateOverride: null, feeExempt: l.Fee_Exempt === 'Y' })),
};
const second: ClosingRecord = {
  id: 'c2', closingNo: 2, closingDate: '2026-11-01', finalised: false, result: null,
  commitments: [
    { lpId: 'LP07', name: 'Eta', amount: 10_000_000, feeRateOverride: null, feeExempt: false },
    { lpId: 'LP01', name: 'Alpha', amount: 2_000_000, feeRateOverride: null, feeExempt: false },
  ],
};
const draft: FundHistory = { terms: [terms], closings: [first, second], calls: [call1] };
const history: FundHistory = { ...draft, closings: [first, { ...second, finalised: true, result: equalize(equalizationInputFor(draft, 'c2')!) }] };

describe('an investor’s capital account', () => {
  it('ends on the fund’s own figures for every investor', () => {
    for (const p of positionsOn(history, '2026-12-01')) {
      const last = capitalAccount(history, p.lpId, '2026-12-01').entries.at(-1)!;
      expect([p.lpId, last.commitmentAfter, last.paidAfter, last.unfundedAfter]).toEqual([p.lpId, p.commitment, p.paidIn, p.unfunded]);
    }
  });

  it('lists, for an investor who increased at the second close, each step in order', () => {
    const a = capitalAccount(history, 'LP01', '2026-12-01');
    expect(a.fromRecord).toBe(true);
    expect(a.entries.map((e) => e.kind)).toEqual(['closing', 'opening', 'call', 'closing', 'equalization']);
    expect(a.entries[3].commitment).toBe(2_000_000);
  });

  it('keeps late-close interest out of the balances', () => {
    const eq = capitalAccount(history, 'LP07', '2026-12-01').entries.find((e) => e.kind === 'equalization')!;
    const line = history.closings[1].result!.lines.find((l) => l.lpId === 'LP07')!;
    expect(eq.interest).toBe(line.interest);
    expect(eq.interest).toBeGreaterThan(0);
    // Paid in is the capital and the catch-up fee; the interest is shown, not counted.
    expect(eq.paidAfter).toBeCloseTo(line.capital + line.catchUpFee, 2);
  });

  it('shows each call as issued for a fund without closings', () => {
    const a = capitalAccount({ ...history, closings: [] }, 'LP01', '2026-12-01');
    const row = call1.lines.find((l) => l.lpId === 'LP01')!;
    expect(a.fromRecord).toBe(false);
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0].paidAfter).toBeCloseTo(row.openPaid + row.total, 2);
    expect(a.entries[0].unfundedAfter).toBeCloseTo(row.openUnfunded - row.reduces, 2);
  });
});

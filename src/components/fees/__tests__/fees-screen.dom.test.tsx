// @vitest-environment jsdom

/**
 * The management fee screen, actually clicked.
 *
 * What matters: nothing on it is entered by hand. A period shows what it costs,
 * what calls billed, and what is still owed; a period billed before the record
 * moved says so, with who owes what and why.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BLANK_TERMS,
  catchUpFeesFor,
  equalize,
  equalizationInputFor,
  feeLedgerFor,
  type ClosingRecord,
  type FundHistory,
  type FundTerms,
  type IssuedCall,
} from '@/engine';
import { FeesScreen } from '../fees-screen';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  // No fee period is billed before the late close here: the catch-up runs to the closing, as these figures were worked.
  catchUpFeeUntil: 'closing_date',
};
const first: ClosingRecord = {
  id: 'c1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
  commitments: [
    { lpId: 'LP01', name: 'Alpha', amount: 6e6, feeRateOverride: null, feeExempt: false },
    { lpId: 'LP02', name: 'Beta', amount: 4e6, feeRateOverride: null, feeExempt: true },
  ],
};
const second: ClosingRecord = {
  id: 'c2', closingNo: 2, closingDate: '2026-08-01', finalised: true, result: null,
  commitments: [{ lpId: 'LP07', name: 'Eta', amount: 5e6, feeRateOverride: null, feeExempt: false }],
};
const before: FundHistory = { terms: [terms], closings: [first], calls: [] };
const after: FundHistory = { ...before, closings: [first, second] };

// Q3 billed on Call No. 1, before the second close admitted LP07.
const call1: IssuedCall = {
  callNo: 1, callDate: '2026-07-05', dueDate: '2026-07-20', lines: [],
  feeSchedule: [{ from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP01: 30_000 } }],
};

afterEach(cleanup);

const show = (history: FundHistory) =>
  render(<FeesScreen fundId="fund-1" ledger={feeLedgerFor(history, '2026-09-25')} catchUps={catchUpFeesFor(history)} terms={terms} />);
const row = (label: string) => screen.getByText(label).closest('tr')!;

describe('the fee, period by period, with nothing to press', () => {
  it('has no Record button anywhere', () => {
    show({ ...after, calls: [call1] });
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a period no call has billed as not billed, and owed in full', () => {
    show(before);
    // LP01, 6,000,000 × 2% × 0.25; LP02 is exempt.
    const q2 = row('Q2 2026');
    expect(within(q2).getByText('Not billed')).toBeTruthy();
    expect(q2.textContent).toContain('30,000.00');
    expect(q2.lastElementChild!.textContent).toBe('30,000.00');
  });

  it('shows a period a call billed in full as billed, with nothing owed', () => {
    show({ ...before, calls: [call1] });
    const q3 = row('Q3 2026');
    expect(within(q3).getByText('Billed')).toBeTruthy();
    expect(q3.textContent).toContain('Call No. 1 (30,000.00)');
    expect(q3.lastElementChild!.textContent).toBe('—');
  });

  it('adds up billed and still owed across the periods', () => {
    show({ ...before, calls: [call1] });
    const stats = document.querySelector('.stat-row') as HTMLElement;
    const stat = (label: string) => within(stats).getByText(label).parentElement!.parentElement!.textContent;
    expect(stat('Billed so far')).toContain('30,000.00');
    // Q1 and Q2, 30,000 each, not billed yet.
    expect(stat('Still owed')).toContain('60,000.00');
    expect(stat('Over-billed')).toContain('None');
  });
});

describe('a period billed before the record moved', () => {
  it('turns to true-up due on its own, and shows who owes what against what was billed', () => {
    show({ ...after, calls: [call1] });
    expect(within(row('Q3 2026')).getByText('True-up due')).toBeTruthy();
    const card = screen.getByText('Q3 2026: true-up').closest('.card') as HTMLElement;
    expect(within(card).getByText('against what was billed on Call No. 1')).toBeTruthy();
    // LP07 from 1 August, 61 of 92 days: 5,000,000 × 2% × 0.25 × 61/92 = 16,576.09
    const lp07 = within(card).getByText('LP07').closest('tr')!;
    expect(lp07.textContent).toContain('0.00');
    expect(lp07.textContent).toContain('+16,576.09');
    // Nobody else moved, so nobody else is listed.
    expect(within(card).queryByText('LP01')).toBeNull();
    expect(row('Q3 2026').lastElementChild!.textContent).toBe('16,576.09');
  });
});

describe('the working', () => {
  it('opens an investor to show basis × rate × share of year', async () => {
    show(after);
    await userEvent.click(screen.getByText('Q3 2026'));
    await userEvent.click(screen.getByText('Eta'));
    expect(screen.getByText('× 2.00% × 0.25 × 61/92')).toBeTruthy();
  });

  it('says an exempt investor pays nothing, rather than showing a zero', async () => {
    show(after);
    await userEvent.click(screen.getByText('Q3 2026'));
    await userEvent.click(screen.getByText('Beta'));
    expect(screen.getByText(/pays no management fee/)).toBeTruthy();
  });
});

describe('the heading', () => {
  it('names the fee basis in words, not as the stored code', () => {
    const on = (feeBasis: string) =>
      render(<FeesScreen fundId="fund-1" ledger={[]} catchUps={[]} terms={{ ...terms, feeBasis }} />).container.textContent;
    expect(on('Invested_Capital')).toContain('2.00% a year on invested capital');
    cleanup();
    expect(on('NAV')).toContain('2.00% a year on NAV');
  });
});

describe('catch-up fees from a later closing', () => {
  const eq = (catchUpFeeTo: FundTerms['catchUpFeeTo']) => {
    const t = { ...terms, catchUpFeeTo };
    const draft: FundHistory = { terms: [t], closings: [first, { ...second, finalised: false }], calls: [] };
    return { ...draft, closings: [first, { ...second, result: equalize(equalizationInputFor(draft, 'c2')!) }] };
  };

  // LP07, 5,000,000 at 2%, 1 Jan – 31 Jul: 25,000 + 25,000 + 25,000 × 31/92 = 58,423.91
  it('lists what the late investor paid, and counts it as the manager’s when it is', () => {
    show(eq('gp'));
    const card = screen.getByText('Catch-up fees from later closings').closest('.card') as HTMLElement;
    const row = within(card).getByText('Closing 2').closest('tr')!;
    expect(row.textContent).toContain('LP07');
    expect(row.textContent).toContain('58,423.91');
    expect(within(row).getByText('The manager')).toBeTruthy();
    const stat = screen.getByText('Catch-up fees to the manager').parentElement!.parentElement!;
    expect(stat.textContent).toContain('58,423.91');
  });

  it('shows who received it when it goes to the investors already in, and counts none as the manager’s', () => {
    show(eq('existing_lps'));
    const card = screen.getByText('Catch-up fees from later closings').closest('.card') as HTMLElement;
    expect(within(card).getByText('The investors already in')).toBeTruthy();
    expect(within(card).getByText('LP01')).toBeTruthy();
    const stat = screen.getByText('Catch-up fees to the manager').parentElement!.parentElement!;
    expect(stat.textContent).toContain('0.00');
  });

  it('is not shown while there are none', () => {
    show(after);
    expect(screen.queryByText('Catch-up fees from later closings')).toBeNull();
  });
});

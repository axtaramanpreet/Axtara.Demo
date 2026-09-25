// @vitest-environment jsdom

/**
 * The fund terms screen, actually clicked.
 *
 * What matters is what reaches the database: a blank goes in as blank, a rate
 * typed as a percentage is stopped before it becomes a 200% fee, a currency or
 * an investor can only be one that exists, and the fee after the investment
 * period is recorded as its own dated change.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: () => {}, replace: () => {} }),
}));

const addFundTerms = vi.fn(async () => []);
vi.mock('@/adapters/storage/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/adapters/storage/supabase-repository', () => ({
  createSupabaseRepository: () => ({ addFundTerms }),
}));

import { BLANK_TERMS, type FundTerms } from '@/engine';
import type { FundInvestor } from '@/adapters/storage/types';
import { FundTermsScreen } from '../fund-terms-screen';

const investors: FundInvestor[] = [
  { lpId: 'GP01', name: 'Fund GP LLC' },
  { lpId: 'LP01', name: 'Alpha Pension Trust' },
  { lpId: 'LP03', name: 'Gamma Family Office' },
  { lpId: 'LP04', name: 'Delta Insurance Co' },
];

const inForce: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2024-01-01',
  createdAt: '2024-01-02T10:00:00Z',
  reportingCurrency: 'USD',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feeReducesUnfunded: true,
};

function renderScreen(history: FundTerms[] = [inForce], canWrite = true) {
  return render(
    <FundTermsScreen fundId="fund-1" history={history} investors={investors} today="2026-09-25" canWrite={canWrite} />,
  );
}

async function openForm() {
  await userEvent.click(screen.getByRole('button', { name: /^Record (a change|the fund)/ }));
}

async function saved(): Promise<FundTerms[]> {
  await userEvent.click(screen.getByRole('button', { name: 'Record' }));
  expect(addFundTerms).toHaveBeenCalledTimes(1);
  const [fundId, rows] = addFundTerms.mock.calls[0] as unknown as [string, FundTerms[]];
  expect(fundId).toBe('fund-1');
  return rows;
}

afterEach(() => {
  cleanup();
  addFundTerms.mockClear();
  refresh.mockClear();
});

describe('what is in force', () => {
  it('shows each term, and flags the ones nobody has set', () => {
    renderScreen();
    expect(screen.getByText('2.00% (0.02)')).toBeDefined();
    expect(screen.getByText('USD — US Dollar')).toBeDefined();
    expect(screen.getAllByText('Not set').length).toBe(unsetCount(inForce));
  });

  it('explains every field behind its (i)', async () => {
    renderScreen();
    const tip = screen.getByRole('button', { name: 'About Rounding plug' });
    fireEvent.focus(tip);
    expect(screen.getByRole('tooltip').textContent).toMatch(/takes that remainder/);
  });

  it('offers no form to someone who may only read', () => {
    renderScreen([inForce], false);
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
    expect(screen.getByText(/can see these terms but not change them/)).toBeDefined();
  });
});

describe('recording a change', () => {
  it('suggests the common choice where nothing is recorded, and says so', async () => {
    renderScreen([]);
    await openForm();
    // USD is suggested for a fund with no terms at all.
    expect((screen.getByRole('combobox', { name: 'Reporting currency' }) as HTMLInputElement).value).toBe('USD — US Dollar');
    expect(screen.getAllByText('Suggested').length).toBeGreaterThan(0);
  });

  it('stops a rate typed as a percentage, and saves nothing', async () => {
    renderScreen();
    await openForm();
    const rate = screen.getByRole('textbox', { name: 'Annual rate' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByRole('alert').textContent).toMatch(/2% is 0.02/);
    expect(addFundTerms).not.toHaveBeenCalled();
  });

  it('finds a currency by its name, and picks an investor from the fund', async () => {
    renderScreen();
    await openForm();

    const currency = screen.getByRole('combobox', { name: 'Reporting currency' });
    await userEvent.click(currency);
    await userEvent.type(currency, 'rupee');
    await userEvent.keyboard('{Enter}');

    const plug = screen.getByRole('combobox', { name: 'Rounding plug' });
    await userEvent.click(plug);
    await userEvent.type(plug, 'delta');
    await userEvent.keyboard('{Enter}');

    const exempt = screen.getByRole('combobox', { name: 'Exempt investors' });
    await userEvent.click(exempt);
    await userEvent.type(exempt, 'GP01{Enter}');
    await userEvent.type(exempt, 'gamma{Enter}');

    const [row] = await saved();
    expect(row.reportingCurrency).toBe('INR');
    expect(row.roundingPlugLpId).toBe('LP04');
    expect(row.feeExemptLpIds).toEqual(['GP01', 'LP03']);
    // Untouched terms carry over; blanks stay blank.
    expect(row.feeRateAnnual).toBe(0.02);
    expect(row.orgExpenseCap).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it('records the fee after the investment period as its own change, from the day after', async () => {
    renderScreen();
    await openForm();

    const ipEnd = screen.getByLabelText('Investment period ends');
    await userEvent.type(ipEnd, '2028-12-31');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Fee basis after the investment period' }),
      'Invested_Capital',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Annual rate after the investment period' }), '0.015');

    const rows = await saved();
    expect(rows).toHaveLength(2);
    expect(rows[0].feeBasis).toBe('Commitment');
    expect(rows[0].feeRateAnnual).toBe(0.02);
    expect(rows[1].effectiveFrom).toBe('2029-01-01');
    expect(rows[1].feeBasis).toBe('Invested_Capital');
    expect(rows[1].feeRateAnnual).toBe(0.015);
    // Everything else about the fund is unchanged from the day after.
    expect(rows[1].reportingCurrency).toBe('USD');
  });

  it('will not schedule it without knowing when the period ends', async () => {
    renderScreen();
    await openForm();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Annual rate after the investment period' }), '0.015');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByRole('alert').textContent).toMatch(/investment period ends first/);
    expect(addFundTerms).not.toHaveBeenCalled();
  });
});

describe('the history', () => {
  const stepDown: FundTerms = {
    ...inForce,
    effectiveFrom: '2029-01-01',
    createdAt: '2024-01-02T10:05:00Z',
    feeRateAnnual: 0.015,
    feeBasis: 'Invested_Capital',
  };

  it('names what each change was, and which row is in force', () => {
    renderScreen([inForce, stepDown]);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Fee basis, Annual rate')).toBeDefined();
    const rows = table.getAllByRole('row');
    expect(rows[1].textContent).toContain('Scheduled');
    expect(rows[2].textContent).toContain('In force');
  });

  it('shows a change recorded for later as scheduled, with what it changes', () => {
    renderScreen([inForce, stepDown]);
    expect(screen.getByText('Scheduled changes')).toBeDefined();
    expect(screen.getByText(/Fee basis: Invested capital · Annual rate: 1.50% \(0.015\)/)).toBeDefined();
  });
});

function unsetCount(t: FundTerms): number {
  const bookkeeping = new Set(['effectiveFrom', 'createdAt', 'note']);
  return Object.entries(t).filter(([k, v]) => !bookkeeping.has(k) && v === null).length;
}

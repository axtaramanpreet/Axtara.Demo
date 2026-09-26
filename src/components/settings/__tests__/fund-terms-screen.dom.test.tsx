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

import { BLANK_TERMS, feeRunFor, termApplies, type FundTerms } from '@/engine';
import type { FundInvestor } from '@/adapters/storage/types';
import { FundTermsScreen } from '../fund-terms-screen';

const investor = (lpId: string, name: string): FundInvestor => ({
  id: `id-${lpId}`, lpId, name, type: 'Pension', email: null, ccEmails: [], country: null, isGp: false, kycStatus: 'not_started', sideLetterRef: null, notes: null,
});
const investors: FundInvestor[] = [
  investor('GP01', 'Fund GP LLC'),
  investor('LP01', 'Alpha Pension Trust'),
  investor('LP03', 'Gamma Family Office'),
  investor('LP04', 'Delta Insurance Co'),
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
    <FundTermsScreen fundId="fund-1" fundName="Fund III" history={history} investors={investors} today="2026-09-25" canWrite={canWrite} />,
  );
}

/** Open the form; for a fund with terms, as a change from a date unless told otherwise. */
async function openForm(kind: 'change' | 'fix' = 'change') {
  const edit = screen.queryByRole('button', { name: 'Edit terms' });
  await userEvent.click(edit ?? screen.getAllByRole('button', { name: /^Record the fund/ })[0]);
  if (edit) await userEvent.click(screen.getByRole('radio', { name: kind === 'fix' ? /Fix a mistake/ : /The terms change from a date/ }));
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
    expect(screen.getByText('2.00%')).toBeDefined();
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
    expect(screen.getByRole('alert').textContent).toMatch(/Write 2% \(or 0.02\)/);
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
    expect(table.getByText('Charged on, Annual rate')).toBeDefined();
    const rows = table.getAllByRole('row');
    expect(rows[1].textContent).toContain('Scheduled');
    expect(rows[2].textContent).toContain('In force');
  });

  it('shows a change recorded for later as scheduled, with what it changes', () => {
    renderScreen([inForce, stepDown]);
    expect(screen.getByText('Scheduled changes')).toBeDefined();
    expect(screen.getByText(/Charged on: Invested capital · Annual rate: 1.50%/)).toBeDefined();
  });
});

describe('fields that only apply once another is set', () => {
  it('asks who gets late-close interest only once there is interest, and stores nothing otherwise', async () => {
    renderScreen();
    await openForm();
    expect(screen.queryByRole('combobox', { name: 'Interest goes to' })).toBeNull();
    expect(screen.getByText('No interest is charged, so there is nothing more to set.')).toBeDefined();
    const [row] = await saved();
    // Suggested in the form, but hidden and so never stored.
    expect([row.lateCloseInterestBasis, row.equalizationInterestTo]).toEqual([null, null]);
  });

  it('shows them as soon as a rate is typed, and takes "8%"', async () => {
    renderScreen();
    await openForm();
    await userEvent.type(screen.getByRole('textbox', { name: 'Interest on catching up' }), '8%');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Interest goes to' }), 'The fund');
    const [row] = await saved();
    expect([row.lateCloseInterestRate, row.equalizationInterestTo]).toEqual([0.08, 'fund']);
  });

  it('hides how the fee is charged when there is no fee', async () => {
    renderScreen([{ ...inForce, feeRateAnnual: null }]);
    await openForm();
    expect(screen.queryByRole('combobox', { name: 'Days counted as' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Catch-up fee goes to' })).toBeNull();
    expect(screen.getByText('Set an annual rate to say how the fee is charged.')).toBeDefined();
  });
});

describe('the management fee, in one place', () => {
  it('says how often in words, and stores the fraction', async () => {
    renderScreen();
    await openForm();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'How often' }), 'Half-yearly');
    const [row] = await saved();
    expect(row.feePeriodFraction).toBe(0.5);
  });

  it('works an example of the day count out under it', async () => {
    renderScreen();
    await openForm();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Days counted as' }), 'Exact days ÷ 365');
    // 10,000,000 × 2% × 92/365 = 50,410.96
    expect(screen.getByText(/10,000,000 × 2.00% × 92\/365 = 50,410.96/)).toBeDefined();
  });

  it('asks when a fund’s first terms start, rather than assuming today', async () => {
    renderScreen([]);
    await openForm();
    expect((screen.getByLabelText('Applies from') as HTMLInputElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByText('The date these terms apply from.')).toBeDefined();
    expect(addFundTerms).not.toHaveBeenCalled();
  });
});

describe('importing the template', () => {
  it('fills the form from a filled-in file, and records nothing until Record', async () => {
    const XLSX = await import('xlsx');
    const { termsTemplate, TERMS_SHEET } = await import('@/adapters/workbook/templates');
    const book = termsTemplate(XLSX as never, 'Fund III', null) as unknown as import('xlsx').WorkBook;
    const sheet = book.Sheets[TERMS_SHEET];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    const put = (label: string, v: string) => {
      const r = rows.findIndex((row) => row[0] === label);
      sheet[XLSX.utils.encode_cell({ r, c: 1 })] = { t: 's', v };
    };
    put('Applies from', '2026-01-15');
    put('Annual rate', '1.75%');
    put('How often', 'Half-yearly');
    put('Billed', 'Sometimes');
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });

    renderScreen();
    await userEvent.upload(screen.getByLabelText('Import from template'), new File([bytes], 'terms.xlsx'));

    expect(await screen.findByText(/terms from terms.xlsx/)).toBeDefined();
    expect(screen.getByText(/Not imported — Billed: One of: In advance, In arrears/)).toBeDefined();
    expect((screen.getByLabelText('Applies from') as HTMLInputElement).value).toBe('2026-01-15');
    expect(addFundTerms).not.toHaveBeenCalled();

    const [row] = await saved();
    expect([row.effectiveFrom, row.feeRateAnnual, row.feePeriodFraction]).toEqual(['2026-01-15', 0.0175, 0.5]);
  });
});

describe('editing terms the fund has already used', () => {
  const closing = {
    id: 'c1', closingNo: 1, closingDate: '2024-01-01', finalised: true, result: null, note: null, finalisedAt: '2024-01-01T00:00:00Z',
    commitments: [{ lpId: 'LP01', name: 'Alpha', amount: 10_000_000, feeRateOverride: null, feeExempt: false, investorId: 'i1', contactEmail: null }],
  };
  const history = { terms: [inForce], closings: [closing], calls: [] };
  // Call No. 1 billed Q1 at 2%.
  const call = {
    callNo: 1, callDate: '2024-02-01', dueDate: '2024-02-15', lines: [],
    feeSchedule: [{ from: '2024-01-01', to: '2024-03-31', label: 'Q1 2024', byLp: Object.fromEntries(feeRunFor(history, '2024-01-01', '2024-03-31').lines.map((l) => [l.lpId, l.fee])) }],
  };
  const show = () =>
    render(
      <FundTermsScreen fundId="fund-1" fundName="Fund III" history={[inForce]} record={{ closings: [closing] as never, calls: [call], drafts: [2] }} investors={investors} today="2026-09-25" canWrite />,
    );

  it('asks what kind of edit it is before anything can be recorded', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Edit terms' }));
    expect(screen.queryByRole('textbox', { name: 'Annual rate' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByText('Say what kind of edit this is.')).toBeDefined();
    expect(addFundTerms).not.toHaveBeenCalled();
  });

  it('fixes a mistake from the original date, keeps what was sent, and shows the true-up it causes', async () => {
    show();
    await openForm('fix');
    expect((screen.getByLabelText('Applies from') as HTMLSelectElement).value).toBe('2024-01-01');
    const rate = screen.getByRole('textbox', { name: 'Annual rate' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '1.75%');

    expect(screen.getByText(/Calls already sent stay exactly as sent/).closest('li')!.textContent).toContain('Call No. 1');
    const q1Row = screen.getByText('Q1 2024').closest('tr')!;
    // 10,000,000 × (2% − 1.75%) × 0.25 = 6,250 back to the investor
    expect(q1Row.textContent).toContain('50,000.00');
    expect(q1Row.textContent).toContain('43,750.00');
    expect(q1Row.textContent).toContain('−6,250.00');
    expect(screen.getByText(/Draft calls follow the new terms/).closest('li')!.textContent).toContain('Call No. 2');

    const [row] = await saved();
    expect([row.effectiveFrom, row.feeRateAnnual]).toEqual(['2024-01-01', 0.0175]);
  });

  it('touches nothing before the date a change applies from', async () => {
    show();
    await openForm('change');
    const rate = screen.getByRole('textbox', { name: 'Annual rate' });
    await userEvent.clear(rate);
    await userEvent.type(rate, '1.5%');
    expect(screen.queryByText(/Calls already sent/)).toBeNull();
    expect(screen.queryByText('Q1 2024')).toBeNull();
  });
});

/** Terms flagged "Not set": blank, and applying. A blank rate reads "None" — no fee, or no interest — rather than a gap. */
function unsetCount(t: FundTerms): number {
  const bookkeeping = new Set(['effectiveFrom', 'createdAt', 'note', 'feeRateAnnual', 'lateCloseInterestRate']);
  return Object.entries(t).filter(([k, v]) => !bookkeeping.has(k) && v === null && termApplies(t, k as keyof FundTerms)).length;
}

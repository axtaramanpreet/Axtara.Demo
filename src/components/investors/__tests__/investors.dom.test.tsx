// @vitest-environment jsdom

/**
 * The investor register and one investor's page.
 *
 * What matters: an unfinished profile says so, a profile saves what was typed
 * and refuses an address that is not one, and the capital account shows the
 * balances it was given — nothing worked out in the browser.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: () => {} }) }));
const updateInvestor = vi.fn(async () => {});
const createInvestor = vi.fn(async () => ({}));
vi.mock('@/adapters/storage/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/adapters/storage/supabase-repository', () => ({ createSupabaseRepository: () => ({ updateInvestor, createInvestor }) }));

import type { FundInvestor } from '@/adapters/storage/types';
import type { CapitalAccount } from '@/engine';
import { InvestorsScreen, nextId } from '../investors-screen';
import { InvestorPage } from '../investor-page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const alpha: FundInvestor = {
  id: 'i1', lpId: 'LP01', name: 'Alpha Pension Trust', type: 'Pension', email: 'ops@alpha.example', ccEmails: ['cfo@alpha.example'],
  country: 'Canada', isGp: false, kycStatus: 'approved', sideLetterRef: null, notes: null,
};
const eta: FundInvestor = { ...alpha, id: 'i7', lpId: 'LP07', name: 'Eta Capital', type: 'LP', email: null, ccEmails: [], country: null, kycStatus: 'not_started' };

describe('the register', () => {
  it('lists each investor with where they stand, and flags an unfinished profile', () => {
    render(
      <InvestorsScreen
        fundId="f1"
        fundName="Fund III"
        investors={[alpha, eta]}
        positions={[{ lpId: 'LP01', name: 'Alpha', commitment: 25e6, paidIn: 2.5e6, unfunded: 22.5e6, invested: 0 }]}
        asOf="after every issued call and closing"
        canWrite
      />,
    );
    const alphaRow = screen.getByText('Alpha Pension Trust').closest('tr')!;
    expect(alphaRow.textContent).toContain('25,000,000.00');
    expect(alphaRow.textContent).toContain('22,500,000.00');
    expect(within(alphaRow).queryByText('Profile incomplete')).toBeNull();
    const etaRow = screen.getByText('Eta Capital').closest('tr')!;
    expect(within(etaRow).getByText('Profile incomplete')).toBeTruthy();
    expect(screen.getByText('Eta Capital').closest('a')!.getAttribute('href')).toBe('/funds/f1/investors/LP07');
  });

  it('adds an investor with the next free ID, and refuses one already taken', async () => {
    render(<InvestorsScreen fundId="f1" fundName="Fund III" investors={[alpha, eta]} positions={[]} asOf="" canWrite />);
    await userEvent.click(screen.getByRole('button', { name: 'Add investor' }));
    expect((screen.getByLabelText('LP_ID') as HTMLInputElement).value).toBe('LP08');
    await userEvent.type(screen.getByLabelText('Legal name'), 'Solberg Foundation');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Foundation');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add investor' }));
    expect(createInvestor).toHaveBeenCalledWith('f1', 'LP08', { name: 'Solberg Foundation', type: 'Foundation' });
    expect(push).toHaveBeenCalledWith('/funds/f1/investors/LP08');
  });

  it('adds one after another without leaving the register', async () => {
    render(<InvestorsScreen fundId="f1" fundName="Fund III" investors={[alpha]} positions={[]} asOf="" canWrite />);
    await userEvent.click(screen.getByRole('button', { name: 'Add investor' }));
    await userEvent.type(screen.getByLabelText('Legal name'), 'Beta Endowment');
    await userEvent.click(screen.getByRole('button', { name: 'Add and add another' }));
    expect(createInvestor).toHaveBeenCalledWith('f1', 'LP02', { name: 'Beta Endowment', type: 'LP' });
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByLabelText('LP_ID') as HTMLInputElement).value).toBe('LP03');
    expect((screen.getByLabelText('Legal name') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Added LP02/)).toBeTruthy();
  });

  it('shows what an imported register would add and change, and saves only on Import', async () => {
    const XLSX = await import('xlsx');
    const { investorsTemplate, INVESTORS_SHEET } = await import('@/adapters/workbook/templates');
    const book = investorsTemplate(XLSX as never, 'Fund III', ['Pension', 'Endowment'], ['Not started', 'Approved']) as unknown as import('xlsx').WorkBook;
    XLSX.utils.sheet_add_aoa(book.Sheets[INVESTORS_SHEET], [
      ['LP01', 'Alpha Pension Trust', '', 'Norway'],
      ['LP05', 'Epsilon Endowment', 'Endowment', 'USA', 'ir@eps.example'],
      ['LP06', '', 'Pension'],
    ], { origin: 'A2' });
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
    render(<InvestorsScreen fundId="f1" fundName="Fund III" investors={[alpha]} positions={[]} asOf="" canWrite />);
    await userEvent.upload(screen.getByLabelText('Import investors'), new File([bytes], 'register.xlsx'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 new')).toBeTruthy();
    expect(within(dialog).getByText('LP01: country')).toBeTruthy();
    expect(within(dialog).getByText(/Row 4 \(LP06\): no legal name/)).toBeTruthy();
    expect(createInvestor).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(createInvestor).toHaveBeenCalledWith('f1', 'LP05', expect.objectContaining({ name: 'Epsilon Endowment', type: 'Endowment', email: 'ir@eps.example' }));
    expect(updateInvestor).toHaveBeenCalledWith('i1', { country: 'Norway' });
  });

  it('numbers from the highest LP in use', () => {
    expect(nextId(['LP01', 'LP09', 'GP01'])).toBe('LP10');
    expect(nextId([])).toBe('LP01');
  });
});

describe('one investor', () => {
  const account: CapitalAccount = {
    fromRecord: true,
    entries: [
      { date: '2026-01-15', kind: 'closing', label: 'Closing 1: committed', commitment: 25e6, paid: 0, drawn: 0, interest: 0, commitmentAfter: 25e6, paidAfter: 0, unfundedAfter: 25e6, ref: {} },
      { date: '2026-03-15', kind: 'call', label: 'Capital Call No. 1', commitment: 0, paid: 2.5e6, drawn: 2.4e6, interest: 0, commitmentAfter: 25e6, paidAfter: 2.5e6, unfundedAfter: 22.6e6, ref: { callNo: 1 } },
    ],
  };

  it('shows the capital account as given, with each document to download', () => {
    render(
      <InvestorPage
        investor={alpha}
        account={account}
        documents={[{ date: '2026-03-15', label: 'Capital Call No. 1 — notice', href: '/api/calls/k1/notices/pdf?lpId=LP01' }]}
        sideLetters={[{ closingNo: 1, date: '2026-01-15', finalised: true, amount: 25e6, feeRate: 0.015, exempt: false }]}
        canWrite
      />,
    );
    expect(screen.getByText('Capital Call No. 1').closest('tr')!.textContent).toContain('22,600,000.00');
    expect(screen.getByRole('link', { name: 'PDF' }).getAttribute('href')).toBe('/api/calls/k1/notices/pdf?lpId=LP01');
    expect(screen.getByText('1.50% by side letter')).toBeTruthy();
  });

  it('saves the profile, copies and all, and refuses an address that is not one', async () => {
    render(<InvestorPage investor={eta} account={{ entries: [], fromRecord: true }} documents={[]} sideLetters={[]} canWrite />);
    expect(screen.getByText(/to finish: investor type, notices email, country/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Family office');
    await userEvent.type(screen.getByLabelText('Country'), 'Norway');
    await userEvent.type(screen.getByLabelText('Notices go to'), 'calls@eta.example');
    await userEvent.type(screen.getByLabelText('Copies to'), 'cfo@eta.example, not-an-address');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByRole('alert').textContent).toBe('Not an email address: not-an-address');
    expect(updateInvestor).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Copies to'));
    await userEvent.type(screen.getByLabelText('Copies to'), 'cfo@eta.example; adviser@eta.example');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(updateInvestor).toHaveBeenCalledWith('i7', expect.objectContaining({
      type: 'Family office', country: 'Norway', email: 'calls@eta.example', ccEmails: ['cfo@eta.example', 'adviser@eta.example'], isGp: true,
    }));
  });

  it('is read-only to someone who cannot change the fund', () => {
    render(<InvestorPage investor={alpha} account={account} documents={[]} sideLetters={[]} canWrite={false} />);
    expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull();
  });
});

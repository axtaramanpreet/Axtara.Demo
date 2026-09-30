// @vitest-environment jsdom

/**
 * Sending a closing's equalization statements, actually clicked.
 *
 * What matters: approving and sending ask the server for an action, never an
 * amount; nothing is sent without a confirmation that says how much is asked
 * for; a failed email can be sent again.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLANK_TERMS, equalize, type EqualizationResult } from '@/engine';
import type { ClosingStatement } from '@/adapters/storage/types';
import { StatementsCard } from '../statements-card';

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ approved: 2, sent: 1, delivered: 1, failed: 0, errors: [] }), { status: 200 }));
vi.stubGlobal('fetch', fetchMock);
afterEach(() => {
  cleanup();
  fetchMock.mockClear();
});

const line = (lpId: string, name: string, net: number) =>
  ({ lpId, name, net, role: net > 0 ? 'late' : 'earlier', commitment: 0, calls: [], capital: 0, inside: 0, interest: 0, catchUpFee: net, feeSlices: [] }) as EqualizationResult['lines'][number];
const result = {
  closingDate: '2026-05-02',
  lines: [line('LP03', 'Gamma', 67_032.97), line('LP01', 'Alpha', -22_344.32), line('LP02', 'Beta', -44_688.65), line('LP09', 'Nil', 0)],
  totals: { interestRate: null, interestBasis: 'simple' },
} as unknown as EqualizationResult;
const statement = (lpId: string, status: ClosingStatement['status'], extra: Partial<ClosingStatement> = {}): ClosingStatement => ({
  closingId: 'c2', lpId, status, paymentDueDate: status === 'draft' ? null : '2026-05-15', approvedAt: '2026-05-03T00:00:00Z', sentAt: status === 'sent' ? '2026-05-04T00:00:00Z' : null,
  sentToEmail: null, emailStatus: null, emailError: null, emailDeliveredTo: null, ...extra,
});

const show = (statements: ClosingStatement[]) => {
  const onChanged = vi.fn();
  render(
    <StatementsCard fundId="fund-1" closingId="c2" closingNo={2} result={result} statements={statements} canWrite statementHref={(id) => `/pdf/${id}`} onChanged={onChanged} />,
  );
  return onChanged;
};
const body = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body));

describe('statements for a closing settled now', () => {
  it('lists everyone the equalization moves money for, and nobody else', () => {
    show([]);
    expect(screen.getByText('pays 67,032.97')).toBeTruthy();
    expect(screen.getByText('receives 22,344.32')).toBeTruthy();
    expect(screen.queryByText('LP09')).toBeNull();
    expect(screen.getByText('0 of 3 sent')).toBeTruthy();
  });

  it('approves by asking for the action, not an amount', async () => {
    const onChanged = show([]);
    await userEvent.click(screen.getByRole('button', { name: 'Approve 3 statements' }));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/funds/fund-1/closings/c2/statements');
    // The closing is Saturday 2 May: ten working days on is Friday 15 May.
    expect(body()).toEqual({ action: 'approve', paymentDueDate: '2026-05-15' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('approves with the date picked, and will not approve one before the closing', async () => {
    show([]);
    const date = screen.getByLabelText('Payable by');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-04-30');
    expect(screen.getByRole('button', { name: 'Approve 3 statements' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Pick a date on or after 2 May 2026\./)).toBeTruthy();
    await userEvent.clear(date);
    await userEvent.type(date, '2026-05-29');
    await userEvent.click(screen.getByRole('button', { name: 'Approve 3 statements' }));
    expect(body()).toEqual({ action: 'approve', paymentDueDate: '2026-05-29' });
  });

  it('lets the date change until one is sent, moving the approved ones with it', async () => {
    show([statement('LP03', 'approved'), statement('LP01', 'approved'), statement('LP02', 'approved')]);
    const date = screen.getByLabelText('Payable by') as HTMLInputElement;
    expect(date.value).toBe('2026-05-15');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-05-22');
    await userEvent.click(screen.getByRole('button', { name: 'Move 3 approved to 22 May 2026' }));
    expect(body()).toEqual({ action: 'approve', paymentDueDate: '2026-05-22' });
  });

  it('fixes the date once one is sent', () => {
    show([statement('LP03', 'sent'), statement('LP01', 'draft')]);
    expect(screen.queryByLabelText('Payable by')).toBeNull();
    expect(screen.getByText('15 May 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve 2 statements' }).hasAttribute('disabled')).toBe(false);
  });

  it('says so, and approves no more, when statements went out before dates were recorded', () => {
    show([statement('LP03', 'sent', { paymentDueDate: null }), statement('LP01', 'draft')]);
    expect(screen.getByText('no date recorded')).toBeTruthy();
    expect(screen.getByText(/sent before a payment date was recorded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve 2 statements' }).hasAttribute('disabled')).toBe(true);
  });

  it('sends only after a confirmation that says how much is asked for and returned', async () => {
    show([statement('LP03', 'approved'), statement('LP01', 'approved'), statement('LP02', 'approved')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send 3 approved' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Asks for 67,032.97 from late investors by 15 May 2026, and tells earlier investors 67,032.97 comes back to them.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send 3 statements' }));
    expect(body()).toEqual({ action: 'send' });
  });

  it('offers to email a failed statement again', async () => {
    show([statement('LP03', 'sent', { emailStatus: 'failed', emailError: 'No notices email for LP03.' })]);
    expect(screen.getByText(/email failed: No notices email for LP03\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Email 1 again' }));
    expect(body()).toEqual({ action: 'retry' });
  });
});

describe('when interest runs to the date investors pay', () => {
  // One call of 1,000,000 (due 15 Feb) split 6 : 4; LP07 5m closes Saturday 1 Aug.
  // LP07's share 333,333.33; 8% simple. To 1 Aug, 167 days: 12,200.91.
  // Suggested payable by Friday 14 Aug, 180 days: 13,150.68 → pays 346,484.01.
  // Picked 31 Aug, 197 days: 14,392.69 → pays 347,726.02.
  const eq = equalize({
    closingDate: '2026-08-01',
    feeStart: '2026-01-01',
    existing: [
      { lpId: 'LP01', name: 'Alpha', commitment: 6e6 },
      { lpId: 'LP02', name: 'Beta', commitment: 4e6 },
    ],
    newcomers: [{ lpId: 'LP07', name: 'Eta', commitment: 5e6 }],
    priorCalls: [{ callNo: 1, dueDate: '2026-02-15', lines: [{ lpId: 'LP01', capital: 600_000, inside: 600_000 }, { lpId: 'LP02', capital: 400_000, inside: 400_000 }] }],
    terms: [{ ...BLANK_TERMS, effectiveFrom: '2026-01-01', createdAt: '', lateCloseInterestRate: 0.08, lateCloseInterestBasis: 'simple' }],
  });

  it('shows the amounts to the date picked', async () => {
    render(<StatementsCard fundId="f" closingId="c2" closingNo={2} result={eq} statements={[]} canWrite statementHref={(id) => id} onChanged={() => {}} />);
    expect(screen.getByText('pays 346,484.01')).toBeTruthy();
    expect(screen.getByText(/Interest runs to this date, so the amounts follow it\./)).toBeTruthy();
    const date = screen.getByLabelText('Payable by');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-08-31');
    expect(screen.getByText('pays 347,726.02')).toBeTruthy();
  });
});

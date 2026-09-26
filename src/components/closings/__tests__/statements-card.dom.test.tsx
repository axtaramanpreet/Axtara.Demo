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
import type { EqualizationResult } from '@/engine';
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
} as EqualizationResult;
const statement = (lpId: string, status: ClosingStatement['status'], extra: Partial<ClosingStatement> = {}): ClosingStatement => ({
  closingId: 'c2', lpId, status, approvedAt: '2026-05-03T00:00:00Z', sentAt: status === 'sent' ? '2026-05-04T00:00:00Z' : null,
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
    expect(body()).toEqual({ action: 'approve' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('sends only after a confirmation that says how much is asked for and returned', async () => {
    show([statement('LP03', 'approved'), statement('LP01', 'approved'), statement('LP02', 'approved')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send 3 approved' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Asks for 67,032.97 from late investors and tells earlier investors 67,032.97 comes back to them.');
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

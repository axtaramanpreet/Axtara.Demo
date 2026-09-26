// @vitest-environment jsdom

/**
 * A new fund's checklist, and naming a new fund.
 *
 * The order is the point: terms, then the first close, then the first call —
 * and the step marked as next is always the first one not done.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: () => {}, replace: () => {} }) }));
const createFund = vi.fn(async (name: string) => ({ id: 'fund-9', name }));
vi.mock('@/adapters/storage/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/adapters/storage/supabase-repository', () => ({ createSupabaseRepository: () => ({ createFund, createCall: vi.fn() }) }));

import { BLANK_TERMS, type FundTerms } from '@/engine';
import type { CallSummary, Closing } from '@/adapters/storage/types';
import { FundSetup, setupSteps } from '../fund-setup';
import { NewFundDialog } from '../new-fund-dialog';
import { fundGates } from '@/lib/fund-gates';

afterEach(() => {
  cleanup();
  push.mockClear();
  createFund.mockClear();
});

const terms: FundTerms = { ...BLANK_TERMS, effectiveFrom: '2026-01-15', createdAt: '2026-01-10T00:00:00Z', feeRateAnnual: 0.02 };
const closing = (finalised: boolean): Closing =>
  ({
    id: 'c1', closingNo: 1, closingDate: '2026-01-15', finalised, result: null, note: null, finalisedAt: null,
    commitments: [{ lpId: 'LP01', name: 'Alpha', amount: 6e6, feeRateOverride: null, feeExempt: false, investorId: 'i1', contactEmail: null }],
  }) as Closing;
const call = (lockedAt: string | null): CallSummary =>
  ({ id: 'k1', callNo: 1, callDate: null, paymentDueDate: null, stage: lockedAt ? 'issued' : 'in_progress', activeInvestors: 1, noticesSent: 0, noticesApproved: 0, noticesDraft: 0, lockedAt }) as CallSummary;

describe('which step is next', () => {
  it('is the terms, for a brand-new fund', () => {
    expect(setupSteps([], { count: 0, incomplete: 0 }, [], []).current).toBe('terms');
  });
  it('is the first close once the terms are in, and it stays there while the close is a draft', () => {
    expect(setupSteps([terms], { count: 0, incomplete: 0 }, [], []).current).toBe('investors');
    expect(setupSteps([terms], { count: 1, incomplete: 0 }, [], []).current).toBe('firstClose');
    const s = setupSteps([terms], { count: 1, incomplete: 0 }, [closing(false)], []);
    expect([s.current, s.firstClose.state]).toEqual(['firstClose', 'started']);
  });
  it('is the first call once the close is finalised, and nothing once it is issued', () => {
    expect(setupSteps([terms], { count: 1, incomplete: 0 }, [closing(true)], []).current).toBe('firstCall');
    expect(setupSteps([terms], { count: 1, incomplete: 0 }, [closing(true)], [call(null)]).firstCall.state).toBe('started');
    expect(setupSteps([terms], { count: 1, incomplete: 0 }, [closing(true)], [call('2026-02-01T00:00:00Z')]).current).toBeNull();
  });
});

describe('the checklist', () => {
  const show = (t: FundTerms[], c: Closing[], k: CallSummary[]) =>
    render(
      <FundSetup
        fundId="f1"
        fundName="Fund III"
        steps={setupSteps(t, { count: c.length ? 1 : 0, incomplete: 0 }, c, k)}
        defaults={{}}
        termsToday={t[0] ?? null}
        gates={fundGates({ hasTerms: t.length > 0, investors: c.length ? 1 : 0, closings: c.length, finalisedClosings: c.filter((x) => x.finalised).length, calls: k.length })}
      />,
    );

  it('lists the steps in order and points the next one at the right screen', () => {
    show([terms], [], []);
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector("strong")!.textContent)).toEqual([
      'Record the fund’s terms',
      'Add the investors',
      'Record the first close',
      'Issue the first capital call',
    ]);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(within(steps[1]).getByRole('link', { name: 'Add investors' }).getAttribute('href')).toBe('/funds/f1/investors');
    expect(within(steps[2]).getByRole('link', { name: 'Record the first close' }).getAttribute('href')).toBe('/funds/f1/closings');
    expect(screen.getByText('1 of 4 done')).toBeTruthy();
  });

  it('keeps a step shut until the one before it is done, and says why', () => {
    show([], [], []);
    const [, , close, call] = screen.getAllByRole('listitem');
    expect((within(close).getByRole('button', { name: 'Record the first close' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(close).getByText(/terms first/)).toBeTruthy();
    expect((within(call).getByRole('button', { name: 'Start the first call' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    show([terms], [closing(false)], []);
    const [, , openClose, shutCall] = screen.getAllByRole('listitem');
    expect(within(openClose).getByRole('link', { name: 'Finish the first close' })).toBeTruthy();
    expect(within(shutCall).getByText(/Finalise the first close first/)).toBeTruthy();
  });

  it('continues a call already started rather than starting another', () => {
    show([terms], [closing(true)], [call(null)]);
    expect(screen.getByRole('link', { name: 'Continue Call No. 1' }).getAttribute('href')).toBe('/funds/f1/calls/k1/setup');
    expect(screen.queryByRole('button', { name: 'Start the first call' })).toBeNull();
  });
});

describe('naming a new fund', () => {
  it('creates it and opens it', async () => {
    render(<NewFundDialog onClose={() => {}} />);
    const create = screen.getByRole('button', { name: 'Create fund' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Fund name'), '  Fund IV, L.P. ');
    await userEvent.click(create);
    // A first fund names no client: it goes to the only one the user belongs to.
    expect(createFund).toHaveBeenCalledWith('Fund IV, L.P.', undefined);
    expect(push).toHaveBeenCalledWith('/funds/fund-9');
  });

  it('warns about a name already in use, and closes on Escape', async () => {
    const onClose = vi.fn();
    render(<NewFundDialog existingNames={['Fund III']} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Fund name'), 'fund iii');
    expect(screen.getByText(/already exists/)).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

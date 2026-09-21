// @vitest-environment jsdom

/**
 * The gate in front of "Review allocation", actually clicked.
 *
 * `readiness.test.ts` pins what counts as missing. It cannot tell whether the
 * button is wired to any of it: a gate that computes the right answer and is
 * never consulted looks identical in a unit test. This drives the real screen
 * in a document and watches whether the click gets through.
 */

import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: () => {}, replace: () => {} }),
}));

// The screen builds a repository on mount. Nothing here saves or deletes, but
// constructing the real one reads Supabase env a test has no business carrying.
vi.mock('@/adapters/storage/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/adapters/storage/supabase-repository', () => ({
  createSupabaseRepository: () => ({ saveCall: vi.fn(), deleteCall: vi.fn() }),
}));

import { emptyCall } from '@/engine/empty-call';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail } from '@/adapters/storage/types';
import type { CallModel } from '@/engine/types';
import { SetupScreen } from '../setup-screen';

function renderScreen(model: CallModel) {
  const call = {
    id: 'call-1',
    clientId: 'client-1',
    callNo: 1,
    stage: 'not_started',
    lockedAt: null,
    sources: {
      setup: 'manual',
      lps: 'manual',
      components: 'manual',
      fee: 'manual',
      transfers: 'manual',
    },
    sourceFileName: null,
    model,
    notices: [],
  } as unknown as CallDetail;

  return render(<SetupScreen call={call} clientId="client-1" previousCall={null} />);
}

const button = () => screen.getByRole('button', { name: /Review allocation/ }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe('a call with nothing in it', () => {
  it('will not calculate, and says what it is short of', () => {
    renderScreen(emptyCall('Demo'));

    expect(button().disabled).toBe(true);
    expect(button().title).toBe(
      'Still needed: a notice date, a payment due date, at least one investor on the register and an amount to call — no components and no fee.',
    );

    // Every gap is named on the page, not only in a tooltip nobody hovers.
    for (const gap of [
      'a notice date',
      'a payment due date',
      'at least one investor on the register',
      'an amount to call — no components and no fee',
    ]) {
      expect(screen.getByRole('link', { name: gap })).toBeDefined();
    }
  });

  it('does nothing when the button is clicked anyway', async () => {
    renderScreen(emptyCall('Demo'));
    await userEvent.click(button());

    // No overlay, no navigation: still on setup.
    expect(screen.queryByText(/Preparing Capital Call/)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('sends each gap to the step that fixes it', async () => {
    renderScreen(emptyCall('Demo'));

    await userEvent.click(
      screen.getByRole('link', { name: 'at least one investor on the register' }),
    );
    expect(screen.getByText('opening balances as at this call')).toBeDefined();
  });
});

describe('a call that has what it needs', () => {
  it('calculates, and says nothing about gaps', async () => {
    renderScreen(ILLUSTRATIVE_FUND as CallModel);

    expect(button().disabled).toBe(false);
    expect(screen.queryByText(/Before this can be calculated/)).toBeNull();

    await userEvent.click(button());
    expect(screen.getByText(/Preparing Capital Call/)).toBeDefined();
  });
});

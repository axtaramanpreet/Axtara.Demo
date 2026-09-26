// @vitest-environment jsdom

/**
 * The notices screen, actually clicked.
 *
 * Everything else in this folder renders to a string and reads the markup,
 * which cannot tell whether a button does anything. A control that is present,
 * named, enabled and wired to nothing looks identical. This drives the real
 * component in a document and watches what it asks the server for.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: () => {}, replace: () => {} }),
}));

import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail, NoticeState, NoticeStatus } from '@/adapters/storage/types';
import { NoticesTab } from '../notices-tab';

const result = compute(ILLUSTRATIVE_FUND);
const active = result.rows.filter((r) => r.isActive);
/** Approved, so both the undo and the send are live. */
const approved = active[0];
/** Still a draft, so the approve is live. */
const draft = active[1];

/** Every request the component made, newest last. */
let sent: { url: string; body: Record<string, unknown> }[] = [];

function notice(lpId: string, status: NoticeStatus): NoticeState {
  return {
    investorId: `id-${lpId}`,
    lpId,
    status,
    approvedAt: status === 'draft' ? null : '2026-09-30T09:00:00Z',
    sentAt: null,
    sentToEmail: null,
    delivery: null,
    deliveryError: null,
    deliveredTo: null,
  };
}

function renderTab() {
  const call = {
    id: 'call-1',
    fundId: 'fund-1',
    callNo: 2,
    stage: 'in_progress',
    lockedAt: null,
    sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
    sourceFileName: null,
    model: ILLUSTRATIVE_FUND,
    notices: active.map((r) => notice(r.LP_ID, r.LP_ID === approved.LP_ID ? 'approved' : 'draft')),
  } as unknown as CallDetail;

  return render(
    <NoticesTab
      call={call}
      result={result}
      email={{ configured: true, overrideTo: null }}
      selectedLp={approved.LP_ID}
      onSelect={() => {}}
    />,
  );
}

beforeEach(() => {
  sent = [];
  refresh.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      sent.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The one control with this accessible name. */
function control(name: string) {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('the tile controls do something', () => {
  it('takes an approved notice back to draft', async () => {
    renderTab();
    const undo = control(`Take the notice for ${approved.LP_Name} back to draft`);
    expect(undo.disabled, 'undo is greyed out on an approved notice').toBe(false);

    await userEvent.click(undo);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe('/api/calls/call-1/notices');
    expect(sent[0].body).toEqual({ action: 'revert', lpIds: [approved.LP_ID] });
  });

  it('approves a draft', async () => {
    renderTab();
    const approve = control(`Approve the notice for ${draft.LP_Name}`);
    expect(approve.disabled, 'approve is greyed out on a draft').toBe(false);

    await userEvent.click(approve);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ action: 'approve', lpIds: [draft.LP_ID] });
  });

  it('shows the result rather than leaving the old figures up', async () => {
    // The server has recorded it; the page has not caught up until this runs.
    renderTab();
    await userEvent.click(control(`Take the notice for ${approved.LP_Name} back to draft`));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('offers nothing to undo on a draft', () => {
    // Not a greyed-out icon: one of those was read as a button that does not
    // work, which is how this file came to exist.
    renderTab();
    expect(
      screen.queryByRole('button', { name: `Take the notice for ${draft.LP_Name} back to draft` }),
    ).toBeNull();
  });
});

describe('the toolbar controls do something', () => {
  it('downloads the notice that is on screen', async () => {
    renderTab();
    await userEvent.click(control(`Download the notice for ${approved.LP_Name}`));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`/api/calls/call-1/notices/pdf?lpId=${approved.LP_ID}`);
  });

  it('approves every draft at once', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /Approve \d+ drafts?/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ action: 'approve', lpIds: undefined });
  });
});

describe('sending one notice', () => {
  it('asks the server to send only the investor on screen', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Send this notice' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ action: 'send', lpIds: [approved.LP_ID] });
  });
});

describe('the undo looks as live as it is', () => {
  /**
   * Reported twice as "disabled" when it was not. jsdom does no layout, but it
   * does apply a stylesheet, so this compares the undo on an approved tile
   * against the approve on a draft one: whatever makes one of them read as
   * pressable has to be true of the other.
   */
  function computed(el: Element) {
    const s = getComputedStyle(el);
    return { cursor: s.cursor, color: s.color, opacity: s.opacity, pointerEvents: s.pointerEvents };
  }

  it('matches the approve beside it in every way that says "press me"', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    document.head.appendChild(style);

    renderTab();
    const undo = control(`Take the notice for ${approved.LP_Name} back to draft`);
    const approve = control(`Approve the notice for ${draft.LP_Name}`);

    expect(undo.disabled).toBe(false);
    expect(computed(undo)).toEqual(computed(approve));
    expect(computed(undo).cursor).toBe('pointer');
    expect(computed(undo).opacity).toBe('1');

    style.remove();
  });
});

describe('an investor with nowhere to send the notice', () => {
  const withoutEmail = (overrideTo: string | null) => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.lps = model.lps.map((l) => (l.LP_ID === 'LP02' ? { ...l, Contact_Email: '' } : l));
    const computed = compute(model);
    const call = {
      id: 'call-1', fundId: 'fund-1', callNo: 2, stage: 'in_progress', lockedAt: null,
      sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
      sourceFileName: null, model,
      notices: computed.rows.filter((r) => r.isActive).map((r) => notice(r.LP_ID, 'draft')),
    } as unknown as CallDetail;
    return render(<NoticesTab call={call} result={computed} email={{ configured: true, overrideTo }} onSelect={() => {}} />);
  };

  it('is named before anything is sent, with the way to fix it', () => {
    withoutEmail(null);
    expect(screen.getByText('No notices email')).toBeTruthy();
    expect(screen.getByText(/LP02 has no address to send to/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Investors' }).getAttribute('href')).toBe('/funds/fund-1/investors');
  });

  it('is not flagged while every notice goes to the test address', () => {
    withoutEmail('tester@axtara.example');
    expect(screen.queryByText('No notices email')).toBeNull();
  });
});

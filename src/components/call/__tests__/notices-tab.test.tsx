/**
 * The notices toolbar.
 *
 * Rendered to static markup rather than driven in a browser: what is being
 * checked is which control is offered at each stage of the workflow, and that
 * is decided during render. It catches the thing types cannot — a toolbar that
 * offers "Send" before anything has been approved, or that loses the
 * investor's name from the detail header.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The component refreshes the page after an action. Nothing here triggers one —
// these render and read the markup — but the hook still has to resolve.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail, NoticeState, NoticeStatus } from '@/adapters/storage/types';
import { NoticesTab } from '../notices-tab';

const result = compute(ILLUSTRATIVE_FUND);
const active = result.rows.filter((r) => r.isActive);

function notice(lpId: string, status: NoticeStatus): NoticeState {
  return {
    investorId: `id-${lpId}`,
    lpId,
    status,
    approvedAt: status === 'draft' ? null : '2026-09-30T09:00:00Z',
    sentAt: status === 'sent' ? '2026-09-30T10:00:00Z' : null,
    sentToEmail: status === 'sent' ? 'treasury@investor.example' : null,
    delivery: status === 'sent' ? 'delivered' : null,
    deliveryError: null,
    deliveredTo: status === 'sent' ? 'treasury@investor.example' : null,
  };
}

/** The call, with every investor's notice at `status`. */
function callWith(status: NoticeStatus, email = { configured: true, overrideTo: null as string | null }) {
  const call = {
    id: 'call-1',
    clientId: 'client-1',
    callNo: 2,
    stage: 'in_progress',
    lockedAt: null,
    sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
    sourceFileName: null,
    model: ILLUSTRATIVE_FUND,
    notices: active.map((r) => notice(r.LP_ID, status)),
  } as unknown as CallDetail;

  return renderToStaticMarkup(
    <NoticesTab call={call} result={result} email={email} onSelect={() => {}} />,
  );
}

describe('which action the toolbar offers', () => {
  it('offers approval, and not sending, while everything is a draft', () => {
    const html = callWith('draft');
    expect(html).toContain(`Approve ${active.length} drafts`);
    expect(html).not.toContain('Send 6 notices');
  });

  it('offers sending once everything is approved', () => {
    const html = callWith('approved');
    expect(html).toContain(`Send ${active.length} notices`);
  });

  it('offers nothing to do once everything is issued', () => {
    const html = callWith('sent');
    expect(html).toContain('Every notice has been issued');
    expect(html).not.toContain('Approve 6 drafts');
    expect(html).not.toContain('Send 6 notices');
  });

  it('counts only the states that exist', () => {
    // "0 draft" on a finished call is noise; the summary lists what is there.
    expect(callWith('sent')).not.toContain('0 draft');
    expect(callWith('draft')).not.toContain('0 sent');
  });
});

describe('what the toolbar says about delivery', () => {
  it('names the redirect quietly when one is in force', () => {
    const html = callWith('draft', { configured: true, overrideTo: 'tester@axtara.example' });
    expect(html).toContain('Test mode');
    expect(html).toContain('tester@axtara.example');
  });

  it('says when nothing can be delivered at all', () => {
    const html = callWith('draft', { configured: false, overrideTo: null });
    expect(html).toContain('No email provider');
  });

  it('says neither when notices really do reach investors', () => {
    const html = callWith('draft');
    expect(html).not.toContain('Test mode');
    expect(html).not.toContain('No email provider');
  });
});

describe('the detail header', () => {
  it('names the investor it is describing', () => {
    // The list beside it shows a different investor whenever the selection is
    // further down, so a status tag with no name reads as a contradiction.
    const html = callWith('draft');
    expect(html).toContain(active[0].LP_Name);
  });

  it('keeps the secondary actions behind a menu rather than beside the primary one', () => {
    const html = callWith('approved');
    expect(html).toContain('aria-haspopup="menu"');
    // Closed by default: the markup holds the trigger, not the items.
    expect(html).not.toContain('Back to draft');
    expect(html).not.toContain('Download PDF');
  });
});

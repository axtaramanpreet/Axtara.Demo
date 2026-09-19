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
import { Button } from '@/components/ui/button';
import { NoticesTab } from '../notices-tab';

const result = compute(ILLUSTRATIVE_FUND);
const active = result.rows.filter((r) => r.isActive);

function notice(lpId: string, status: NoticeStatus, failed = false): NoticeState {
  return {
    investorId: `id-${lpId}`,
    lpId,
    status,
    approvedAt: status === 'draft' ? null : '2026-09-30T09:00:00Z',
    sentAt: status === 'sent' ? '2026-09-30T10:00:00Z' : null,
    sentToEmail: status === 'sent' ? 'treasury@investor.example' : null,
    delivery: status !== 'sent' ? null : failed ? 'failed' : 'delivered',
    deliveryError: failed ? 'Domain is not verified.' : null,
    deliveredTo: status === 'sent' && !failed ? 'treasury@investor.example' : null,
  };
}

/** The call, with every investor's notice at `status`. */
function callWith(
  status: NoticeStatus,
  email = { configured: true, overrideTo: null as string | null },
  failed = false,
) {
  const call = {
    id: 'call-1',
    clientId: 'client-1',
    callNo: 2,
    stage: 'in_progress',
    lockedAt: null,
    sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
    sourceFileName: null,
    model: ILLUSTRATIVE_FUND,
    notices: active.map((r) => notice(r.LP_ID, status, failed)),
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

  it('keeps the call-wide secondary actions behind a menu', () => {
    const html = callWith('approved');
    expect(html).toContain('aria-haspopup="menu"');
    // Closed by default: the markup holds the trigger, not the items.
    expect(html).not.toContain('Download all as .zip');
    expect(html).not.toContain('Print all');
  });
});

/**
 * The investor list and the notices carry the same two actions, so an assertion
 * against the whole document cannot tell which one it found. These split it.
 */
function tiles(html: string) {
  const start = html.indexOf('aria-label="Investors"');
  const end = html.indexOf('</nav>');
  expect(start, 'no investor list in the markup').toBeGreaterThan(-1);
  return html.slice(start, end);
}

function notices(html: string) {
  return html.slice(html.indexOf('</nav>'));
}

/** The opening tag of the button with this accessible name. */
function control(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<button[^>]*aria-label="${escaped}"[^>]*>`).exec(html)?.[0] ?? null;
}

describe('the actions on one notice', () => {
  /** Every icon button in the markup. */
  function iconButtons(html: string) {
    return html.match(/<button[^>]*btn-icon[^>]*>/g) ?? [];
  }

  const lp = active[0].LP_Name;

  it('offers only the download on a draft', () => {
    // Approving is the tile's job. Two copies of it on one screen is two
    // places to look and one of them to keep in step.
    const html = notices(callWith('draft'));
    expect(html).toContain(`aria-label="Download the notice for ${lp}"`);
    expect(html).not.toContain(`aria-label="Approve the notice for ${lp}"`);
    expect(html).not.toContain('btn-primary');
  });

  it('offers sending once it is approved, and says so in a word', () => {
    // The one irreversible action on the screen does not get to be a glyph.
    const html = notices(callWith('approved'));
    const send = /<button[^>]*btn-primary[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(send, 'no primary action on an approved notice').not.toBeNull();
    expect(send![1]).toContain('Send');
  });

  it('leaves approving and undoing to the tile', () => {
    const html = notices(callWith('approved'));
    expect(html).not.toContain(`aria-label="Approve the notice for ${lp}"`);
    expect(html).not.toContain('back to draft');
  });

  it('offers nothing but the download once it is sent', () => {
    // An issued notice is frozen; there is no control that could change it.
    const html = notices(callWith('sent'));
    expect(html).toContain(`aria-label="Download the notice for ${lp}"`);
    expect(html).not.toContain('btn-primary');
    expect(html).not.toContain('back to draft');
  });

  it('names every icon, since none of them carry a visible label', () => {
    // The whole point of shrinking these to icons is that the wording is gone
    // from the screen. It must not also be gone from a screen reader.
    for (const status of ['draft', 'approved', 'sent'] as const) {
      const buttons = iconButtons(callWith(status));
      expect(buttons.length, status).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button, `${status}: ${button}`).toMatch(/aria-label="[^"]+"/);
      }
    }
  });

  it('gives every icon a tooltip as well, for a mouse that is not sure', () => {
    for (const button of iconButtons(callWith('approved'))) {
      expect(button, button).toMatch(/title="[^"]+"/);
    }
  });
});

describe('the actions on an investor tile', () => {
  const lp = active[0].LP_Name;
  const approve = `Approve the notice for ${lp}`;
  const undo = `Take the notice for ${lp} back to draft`;

  it('carries both on every tile, in every state', () => {
    // Hiding them would move the rows around as a call progresses, and would
    // leave nothing to explain why an investor has no approve on them.
    for (const status of ['draft', 'approved', 'sent'] as const) {
      const html = tiles(callWith(status));
      expect(control(html, approve), `approve missing on ${status}`).not.toBeNull();
      expect(control(html, undo), `undo missing on ${status}`).not.toBeNull();
    }
  });

  it('enables approve only while the notice is a draft', () => {
    expect(control(tiles(callWith('draft')), approve)).not.toContain('disabled');
    expect(control(tiles(callWith('approved')), approve)).toContain('disabled');
    expect(control(tiles(callWith('sent')), approve)).toContain('disabled');
  });

  it('enables undo only once the notice is approved', () => {
    // A draft has nowhere to be taken back to, and an issued notice is frozen.
    expect(control(tiles(callWith('approved')), undo)).not.toContain('disabled');
    expect(control(tiles(callWith('draft')), undo)).toContain('disabled');
    expect(control(tiles(callWith('sent')), undo)).toContain('disabled');
  });

  it('says why an icon is unavailable rather than just greying it', () => {
    expect(control(tiles(callWith('approved')), approve)).toContain('Already approved');
    expect(control(tiles(callWith('draft')), undo)).toContain('still a draft');
    expect(control(tiles(callWith('sent')), undo)).toContain('cannot be taken back');
  });
});

describe('showing that something is happening', () => {
  it('ships a spinner style the buttons can use', () => {
    // The markup is static here, so what is checked is that the mechanism
    // exists and is wired: `loading` puts a .spinner inside the button and
    // marks it busy for a screen reader.
    const html = renderToStaticMarkup(
      <Button variant="primary" loading>
        Approve
      </Button>,
    );

    expect(html).toContain('spinner');
    expect(html).toContain('aria-busy="true"');
    // The label stays, so the row does not change width mid-action.
    expect(html).toContain('Approve');
  });

  it('disables a loading button without being told to', () => {
    const html = renderToStaticMarkup(<Button loading>Send</Button>);
    expect(html).toContain('disabled');
  });

  it('leaves an idle button alone', () => {
    const html = renderToStaticMarkup(<Button variant="primary">Approve</Button>);
    expect(html).not.toContain('spinner');
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('disabled');
  });

  it('keeps a label-free button at a fixed width while it works', () => {
    // Without this the spinner replaces the icon, the button shrinks to fit it,
    // and every control beside it slides along mid-action.
    const html = renderToStaticMarkup(
      <Button iconOnly small variant="ghost" aria-label="Approve" loading />,
    );
    expect(html).toContain('btn-icon');
    expect(html).toContain('btn-sm');
  });
});

describe('what the notice says about its own delivery', () => {
  it('stays quiet when the email arrived', () => {
    // The address it went to is on the record either way; repeating it under
    // every notice read as a problem on a notice that is fine.
    const html = notices(callWith('sent'));
    expect(html).not.toContain('Emailed to');
    expect(html).not.toContain('treasury@investor.example');
  });

  it('says so loudly when it did not', () => {
    // The quiet line went; this one must not. A notice whose email failed is
    // the one thing on this screen that needs somebody to act.
    const html = notices(callWith('sent', undefined, true));
    expect(html).toContain('Email not delivered');
    expect(html).toContain('Domain is not verified.');
    expect(html).toContain('role="alert"');
  });

  it('does not nag about a missing address on the register', () => {
    // Built with the address actually removed, so this fails if the line
    // comes back rather than passing because there was nothing to say.
    const model = {
      ...ILLUSTRATIVE_FUND,
      lps: ILLUSTRATIVE_FUND.lps.map((lp, i) => (i === 0 ? { ...lp, Contact_Email: '' } : lp)),
    };
    const own = compute(model);
    const call = {
      id: 'call-1',
      clientId: 'client-1',
      callNo: 2,
      stage: 'in_progress',
      lockedAt: null,
      sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
      sourceFileName: null,
      model,
      notices: own.rows.filter((r) => r.isActive).map((r) => notice(r.LP_ID, 'sent')),
    } as unknown as CallDetail;

    const html = notices(
      renderToStaticMarkup(
        <NoticesTab
          call={call}
          result={own}
          email={{ configured: true, overrideTo: null }}
          onSelect={() => {}}
        />,
      ),
    );

    expect(html).not.toContain('add one in the LP register');
    // The register really is missing it — otherwise the assertion above is
    // checking nothing.
    expect(model.lps[0].Contact_Email).toBe('');
  });
});

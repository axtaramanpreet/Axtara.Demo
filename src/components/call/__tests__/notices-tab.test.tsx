/**
 * The notices toolbar.
 *
 * Rendered to static markup rather than driven in a browser: what is being
 * checked is which control is offered at each stage of the workflow, and that
 * is decided during render. It catches the thing types cannot — a toolbar that
 * offers "Send" before anything has been approved, or that loses the
 * investor's name from the detail header.
 */

import { readFileSync } from 'node:fs';
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
import { NoticesTab, STATUS_COLUMN } from '../notices-tab';

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

  /** How many buttons the notice's own header carries. */
  function buttons(html: string) {
    return html.match(/<button/g)?.length ?? 0;
  }

  it('carries no controls at all', () => {
    // Every action on a notice is either on the investor's tile or in the
    // toolbar. This line says which notice is on screen and where it has got
    // to; nothing floats above the page any more.
    for (const status of ['draft', 'approved', 'sent'] as const) {
      expect(buttons(notices(callWith(status))), status).toBe(0);
    }
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

  it('offers approval on a draft and nothing else', () => {
    const html = tiles(callWith('draft'));
    expect(control(html, approve)).not.toBeNull();
    expect(control(html, undo)).toBeNull();
  });

  it('offers undo once it is approved and nothing else', () => {
    const html = tiles(callWith('approved'));
    expect(control(html, undo)).not.toBeNull();
    expect(control(html, approve)).toBeNull();
  });

  it('offers neither once it is issued', () => {
    const html = tiles(callWith('sent'));
    expect(control(html, approve)).toBeNull();
    expect(control(html, undo)).toBeNull();
  });

  it('leaves the place empty rather than putting a dead icon in it', () => {
    // A greyed-out icon reads as a button that does not work — somebody will
    // press it and conclude the screen is broken. The slot is held open so the
    // column still does not move as a call progresses.
    for (const status of ['draft', 'approved', 'sent'] as const) {
      const html = tiles(callWith(status));
      const slots = html.match(/class="slot"/g) ?? [];
      expect(slots, status).toHaveLength(active.length * 2);
    }
  });

  it('never offers an action it would refuse', () => {
    // Whatever is rendered is pressable: nothing here is disabled.
    for (const status of ['draft', 'approved', 'sent'] as const) {
      const html = tiles(callWith(status));
      expect(html, status).not.toContain('disabled');
    }
  });
});

describe('the header sits in the document\u2019s column', () => {
  /** The inline style of the first element matching `open`. */
  function styleOf(html: string, open: RegExp) {
    const style = open.exec(html)?.[1];
    expect(style, `no element matching ${open}`).toBeDefined();
    return style!;
  }

  function prop(style: string, name: string) {
    return new RegExp(`(?:^|;)${name}:([^;]+)`).exec(style)?.[1] ?? null;
  }

  /** The left/right value out of a one- or two-part padding shorthand. */
  function sideways(padding: string | null) {
    const parts = String(padding).trim().split(/\s+/);
    return parts.length === 1 ? parts[0] : parts[1];
  }

  const html = notices(callWith('sent'));
  const strip = styleOf(html, /<div[^>]*data-noprint="1"[^>]*style="([^"]*)"/);
  const sheet = styleOf(html, /<article[^>]*style="([^"]*)"/);

  it('is the same width as the notice', () => {
    // Full width, it ran out past the page on both sides and the download
    // floated in space beside it.
    expect(prop(strip, 'max-width')).toBe(prop(sheet, 'max-width'));
    expect(prop(strip, 'max-width')).toBeTruthy();
  });

  it('starts and ends on the notice\u2019s own margins', () => {
    // So the investor's name begins where the letter begins, and the buttons
    // finish where it finishes.
    expect(sideways(prop(strip, 'padding'))).toBe(sideways(prop(sheet, 'padding')));
  });

  it('is centred the same way', () => {
    expect(prop(strip, 'margin')).toContain('auto');
    expect(prop(sheet, 'margin')).toContain('auto');
  });
});

describe('where the download lives', () => {
  /** Everything above the investor list: the actions for the whole call. */
  function toolbar(html: string) {
    return html.slice(0, html.indexOf('aria-label="Investors"'));
  }

  const lp = active[0].LP_Name;

  it('sits with the call-wide actions, not above the page', () => {
    expect(toolbar(callWith('draft'))).toContain(`aria-label="Download the notice for ${lp}"`);
  });

  it('sits between the menu and the primary action', () => {
    const bar = toolbar(callWith('draft'));
    const menu = bar.indexOf('aria-haspopup="menu"');
    const download = bar.indexOf('aria-label="Download the notice');
    const primary = bar.indexOf('btn-primary');

    expect(menu).toBeGreaterThan(-1);
    expect(menu).toBeLessThan(download);
    expect(download).toBeLessThan(primary);
  });

  it('downloads the investor whose notice is on screen', () => {
    // It names one investor, so it had better be the selected one.
    const bar = toolbar(callWith('draft'));
    for (const other of active.slice(1)) {
      expect(bar, other.LP_Name).not.toContain(`Download the notice for ${other.LP_Name}`);
    }
  });
});

describe('the status tags line up', () => {
  it('reserves the same column on every tile', () => {
    // Pushed to the right of each tile, a long label moved its own dot left
    // and the column zig-zagged down the list. An explicit width cannot.
    const nav = tiles(callWith('draft'));
    const cells = nav.match(new RegExp(`width:${STATUS_COLUMN}px`, 'g')) ?? [];
    expect(cells).toHaveLength(active.length);
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

describe('the stylesheet an icon button depends on', () => {
  // jsdom does no layout, so nothing above can see where a glyph actually
  // lands. This reads the rule instead. It is a weak test for a real bug: an
  // icon button has a fixed width and no padding, so without centring the
  // glyph sat against its left edge and the button looked broken.
  const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');

  /**
   * The body of one rule.
   *
   * Anchored to the start of a line, or `.btn-icon` also matches inside
   * `.btn-ghost.btn-icon` and reads the wrong rule.
   */
  function rule(selector: string) {
    const found = new RegExp(`\n\\${selector} \\{([^}]*)\\}`).exec(css);
    expect(found, `no ${selector} rule`).not.toBeNull();
    return found![1];
  }

  it('centres what is inside a button', () => {
    expect(rule('.btn')).toContain('justify-content: center');
  });

  it('gives an icon button a width of its own', () => {
    expect(rule('.btn-icon')).toContain('width:');
    expect(rule('.btn-icon')).toContain('padding: 0');
  });

  it('holds a list row open where an action does not apply', () => {
    // Same width as `.btn-icon.btn-sm`, or the column moves.
    expect(rule('.slot')).toContain('width: 28px');
    expect(rule('.btn-icon.btn-sm')).toContain('width: 28px');
  });
});

describe('an icon button does not look disabled when it is not', () => {
  const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');

  it('gives a ghost icon the full text colour, not the muted one', () => {
    // Muted grey is for a worded ghost button sitting beside a real one. An
    // icon has no word to say it can be pressed, so grey reads as off.
    const rule = /\.btn-ghost\.btn-icon \{([^}]*)\}/.exec(css);
    expect(rule, 'no .btn-ghost.btn-icon rule').not.toBeNull();
    expect(rule![1]).toContain('var(--foreground)');
  });

  it('still dims one that really is disabled', () => {
    const rule = /\.btn:disabled \{([^}]*)\}/.exec(css);
    expect(rule, 'no .btn:disabled rule').not.toBeNull();
    expect(rule![1]).toContain('opacity');
  });
});

describe('a tile row cannot outgrow the list it is in', () => {
  /**
   * The undo was unclickable for two days because the row was 326px wide in a
   * 268px list. The overflow slid under the notice pane beside it, which paints
   * later and so swallowed every click on the last icon in the row.
   *
   * jsdom does no layout, so this cannot measure the overflow — it pins the two
   * things that prevented it. Only a browser can prove the geometry; see the
   * note in the commit that fixed it.
   */
  const html = tiles(callWith('approved'));

  it('lets every row shrink to the width of the list', () => {
    // A grid item keeps `min-width: auto` — the width of its content — unless
    // it is told otherwise, and then it overflows instead of truncating.
    const rows = html.match(/<div style="display:flex;align-items:center;gap:2px[^"]*"/g) ?? [];
    expect(rows, 'no tile rows in the markup').toHaveLength(active.length);
    for (const row of rows) expect(row).toContain('min-width:0');
  });

  it('gives the list room for a name, a status and both actions', () => {
    const nav = /aria-label="Investors"[^>]*style="([^"]*)"/.exec(html);
    expect(nav, 'no investor list').not.toBeNull();
    const width = /width:(\d+)px/.exec(nav![1]);
    expect(width, 'the list has no width').not.toBeNull();
    // 76 for the status, 56 for the two actions, and the rest for the name.
    expect(Number(width![1])).toBeGreaterThanOrEqual(STATUS_COLUMN + 56 + 160);
  });
});

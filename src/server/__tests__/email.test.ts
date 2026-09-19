/**
 * Sending notices by email.
 *
 * Nothing here reaches a provider: `fetch` is stubbed, so these run anywhere
 * and cost nothing. What they pin is the part that would do damage if it were
 * wrong — that the override really does intercept every address, that a
 * failure is reported rather than swallowed, and that the PDF goes with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNotice, compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { deliver } from '../email';
import { noticeEmail } from '../notice-email';

const result = compute(ILLUSTRATIVE_FUND);
const row = result.rows.find((r) => r.LP_ID === 'LP01')!;
const notice = buildNotice(ILLUSTRATIVE_FUND, result, row);
const pdf = Buffer.from('%PDF-1.7 not really');

/** What the last stubbed request was given. */
let lastBody: Record<string, unknown> | null = null;

function stubProvider(response: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      lastBody = JSON.parse(init.body);
      return {
        ok: response.status < 400,
        status: response.status,
        statusText: 'Stubbed',
        json: async () => response.body,
      };
    }),
  );
}

beforeEach(() => {
  lastBody = null;
  vi.stubEnv('EMAIL_PROVIDER', 'resend');
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('EMAIL_FROM', 'Axtara <notices@notices.example>');
  vi.stubEnv('EMAIL_REPLY_TO', 'admin@axtara.example');
  vi.stubEnv('EMAIL_OVERRIDE_TO', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the override', () => {
  it('redirects every notice, whatever the register says', async () => {
    vi.stubEnv('EMAIL_OVERRIDE_TO', 'tester@axtara.example');
    stubProvider({ status: 200, body: { id: 'msg-1' } });

    const outcome = await deliver(noticeEmail(notice, pdf, 'treasury@a-real-investor.example'));

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.deliveredTo).toBe('tester@axtara.example');
    // The investor's own address must not reach the provider at all.
    expect(lastBody?.to).toEqual(['tester@axtara.example']);
    expect(JSON.stringify(lastBody)).not.toContain('a-real-investor.example');
  });

  it('sends to the investor once it is cleared', async () => {
    stubProvider({ status: 200, body: { id: 'msg-2' } });
    const outcome = await deliver(noticeEmail(notice, pdf, 'treasury@investor.example'));
    expect(outcome.ok && outcome.deliveredTo).toBe('treasury@investor.example');
  });
});

describe('what gets sent', () => {
  it('carries the PDF, the reply-to and the amount in the subject', async () => {
    stubProvider({ status: 200, body: { id: 'msg-3' } });
    await deliver(noticeEmail(notice, pdf, 'treasury@investor.example'));

    expect(lastBody?.from).toBe('Axtara <notices@notices.example>');
    expect(lastBody?.reply_to).toBe('admin@axtara.example');
    expect(String(lastBody?.subject)).toContain(notice.total);
    expect(String(lastBody?.subject)).toContain(notice.fund);

    const attachments = lastBody?.attachments as { filename: string; content: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('Capital Call #2_Alpha Pension Trust.pdf');
    expect(Buffer.from(attachments[0].content, 'base64').toString()).toBe(pdf.toString());
  });

  it('names the investor and the due date in the body', async () => {
    const email = noticeEmail(notice, pdf, 'treasury@investor.example');
    expect(email.text).toContain(notice.name);
    expect(email.text).toContain(notice.dueDate);
    expect(email.text).toContain(notice.total);
  });
});

describe('when it does not work', () => {
  it('reports the provider’s reason rather than throwing', async () => {
    stubProvider({ status: 422, body: { message: 'Domain is not verified.' } });
    const outcome = await deliver(noticeEmail(notice, pdf, 'treasury@investor.example'));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBe('Domain is not verified.');
  });

  it('reports a network failure rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    const outcome = await deliver(noticeEmail(notice, pdf, 'treasury@investor.example'));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBe('socket hang up');
  });

  it('says so plainly when no provider is configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const outcome = await deliver(noticeEmail(notice, pdf, 'treasury@investor.example'));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatch(/RESEND_API_KEY/);
  });

  it('refuses a provider it cannot actually send with', async () => {
    vi.stubEnv('EMAIL_PROVIDER', 'postmark');
    const outcome = await deliver(noticeEmail(notice, pdf, 'treasury@investor.example'));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatch(/postmark/);
  });
});

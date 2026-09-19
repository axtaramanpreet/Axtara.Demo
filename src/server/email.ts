/**
 * Sending email.
 *
 * One narrow interface with one adapter behind it, so changing provider is a
 * change to `deliver` and an environment variable — not a change anywhere a
 * notice is issued.
 *
 * Nothing here decides *whether* to send, or *what* a notice says. It is handed
 * a rendered document and an address, and reports what happened. Deciding is
 * `call-actions.ts`, which has already frozen the figures by the time this runs.
 */

import { emailEnv } from '@/lib/env';

export interface Attachment {
  filename: string;
  content: Buffer;
}

export interface Email {
  to: string;
  subject: string;
  /** Plain text. Every client can read it, and a notice is not a newsletter. */
  text: string;
  attachments?: Attachment[];
}

export type DeliveryResult =
  | { ok: true; messageId: string | null; deliveredTo: string }
  | { ok: false; error: string; deliveredTo: string | null };

/**
 * Send one email.
 *
 * Never throws: a delivery failure is an outcome to record against the notice,
 * not an exception that would roll back an issue that has already happened.
 */
export async function deliver(email: Email): Promise<DeliveryResult> {
  const config = emailEnv();
  if (!config) {
    return {
      ok: false,
      error: 'No email provider is configured. Set RESEND_API_KEY and EMAIL_FROM.',
      deliveredTo: null,
    };
  }

  if (config.provider !== 'resend') {
    return {
      ok: false,
      error: `EMAIL_PROVIDER "${config.provider}" is not one this build knows how to send with.`,
      deliveredTo: null,
    };
  }

  // The override wins over whatever the register says. It is the reason a test
  // deployment can be pointed at real investor data without risk.
  const to = config.overrideTo || email.to;
  if (!to) {
    return { ok: false, error: 'No address to send to.', deliveredTo: null };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        subject: email.subject,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        })),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok) {
      // Resend reports the reason in `message`; falling back to the status
      // keeps an unrecognised shape from becoming "undefined".
      return {
        ok: false,
        error: body.message || `${response.status} ${response.statusText}`,
        deliveredTo: to,
      };
    }

    return { ok: true, messageId: body.id ?? null, deliveredTo: to };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'The provider could not be reached.',
      deliveredTo: to,
    };
  }
}

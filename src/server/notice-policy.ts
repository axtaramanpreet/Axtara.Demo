/**
 * The rules that decide whether notices may be approved or sent.
 *
 * Kept separate from the database work so they can be tested directly. These
 * are the rules that stand between a mistake and an investor being told they
 * owe money, and they should not only be exercised through a live Postgres and
 * an HTTP round trip.
 */

import type { Check, ComputeResult } from '@/engine';
import type { NoticeState } from '@/adapters/storage/types';

export interface Decision {
  ok: boolean;
  /** Why not, in words an accountant can act on. Empty when ok. */
  reason: string;
}

/**
 * May this call's notices be approved?
 *
 * Approval is the moment a person takes responsibility for the figures, so a
 * failing tie-out blocks it outright. Warnings do not: they are judgement
 * calls — an investor called beyond their unfunded commitment can be perfectly
 * correct — and the accountant is the one to make them.
 */
export function canApprove(checks: Check[]): Decision {
  const failing = checks.filter((c) => c.level === 'fail');
  if (failing.length) {
    return {
      ok: false,
      reason: `${failing.length} check${failing.length === 1 ? ' is' : 's are'} failing. Resolve them before approving notices.`,
    };
  }
  return { ok: true, reason: '' };
}

/**
 * Which notices may actually go out.
 *
 * Only approved ones, so sending can never skip review — even if a client asks
 * for an investor who is still in draft. Anything requested but not approved is
 * reported rather than silently dropped, because "sent 4" when you asked for 6
 * is the kind of surprise worth naming.
 */
export function sendableLpIds(
  notices: NoticeState[],
  requested?: string[],
): { send: string[]; skipped: string[] } {
  const approved = notices.filter((n) => n.status === 'approved').map((n) => n.lpId);

  if (!requested) return { send: approved, skipped: [] };

  return {
    send: requested.filter((id) => approved.includes(id)),
    skipped: requested.filter((id) => !approved.includes(id)),
  };
}

/** Investors who can be acted on at all: the ones the call is actually against. */
export function actionableLpIds(result: ComputeResult, requested?: string[]): string[] {
  const active = result.rows.filter((r) => r.isActive).map((r) => r.LP_ID);
  return requested ? requested.filter((id) => active.includes(id)) : active;
}

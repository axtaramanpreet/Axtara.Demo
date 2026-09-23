/**
 * Approving and sending notices.
 *
 * These are the operations a browser is deliberately barred from: `notices`,
 * `call_results` and `audit_log` carry read policies only, so these writes can
 * only happen here, with the service role.
 *
 * Three rules hold throughout.
 *
 * 1. The server recomputes from stored inputs. Nothing a client sends is
 *    treated as a figure — the browser can say which investors to send to, not
 *    what they owe.
 * 2. Nothing is approved while a check is failing. That rule has to live here,
 *    because a browser could otherwise approve its way past it.
 * 3. Sending freezes a snapshot first. The notice payload is stored alongside
 *    the engine version that produced it, so what an investor was told can
 *    always be recovered, whatever the inputs look like later.
 */

import { buildNotice, compute, round } from '@/engine';
import { approvableLpIds, canApprove, sendableLpIds } from './notice-policy';
import { createServiceSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import type { Json } from '@/adapters/storage/database.types';
import type { ComputeResult } from '@/engine';
import { deliver } from './email';
import { emailEnv } from '@/lib/env';
import { noticeEmail } from './notice-email';
import { renderNoticePdf } from './notice-pdf';

/** Identifies the engine that produced a snapshot, for later reconciliation. */
const ENGINE_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.ENGINE_VERSION ?? 'dev';

/**
 * Prepare a value for a JSONB column.
 *
 * The round-trip is not ceremony: it drops `undefined`, which Postgres has no
 * representation for, and it is exactly what the value goes through on the wire
 * anyway. Doing it here means the stored shape is the one that was checked.
 */
function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Check the caller may act on this call, and load it.
 *
 * Reading happens as the user, so row-level security decides what they can
 * see; a call they cannot read is reported as missing rather than forbidden,
 * which avoids confirming that someone else's call exists.
 */
async function loadAuthorised(callId: string) {
  const userClient = await getServerSupabase();

  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) throw new ActionError('You are not signed in.', 401);

  const repo = createSupabaseRepository(userClient as unknown as SupabaseClient);
  const call = await repo.getCall(callId);
  if (!call) throw new ActionError('That capital call could not be found.', 404);

  const { data: canWrite } = await userClient.rpc('auth_can_write_call', {
    target_call: callId,
  });
  if (!canWrite) {
    throw new ActionError('You do not have permission to change notices for this call.', 403);
  }

  return { call, user, userClient };
}

/**
 * Move drafts to approved.
 *
 * Refused outright while any check is failing — approval is the point at which
 * a human takes responsibility for the figures, and it should not be possible
 * to take that step over a failing tie-out.
 */
export async function approveNotices(callId: string, lpIds?: string[]) {
  const { call, user } = await loadAuthorised(callId);

  const result = compute(call.model);

  const decision = canApprove(result.checks);
  if (!decision.ok) throw new ActionError(decision.reason, 409);

  // Drafts only, so approving can never reach a notice that has already gone
  // out and put it back in line to be sent again.
  const { approve: targets, skipped } = approvableLpIds(result, call.notices, lpIds);
  if (!targets.length) throw new ActionError('There are no draft notices to approve.', 400);

  const service = createServiceSupabase();
  const investors = await investorIdsByLp(service, call.clientId, targets);
  const now = new Date().toISOString();

  const { error } = await service.from('notices').upsert(
    targets.map((lpId) => ({
      call_id: callId,
      investor_id: investors[lpId],
      status: 'approved',
      approved_at: now,
      approved_by: user.id,
    })),
    { onConflict: 'call_id,investor_id' },
  );
  if (error) throw new ActionError(error.message, 400);

  await audit(service, call, user.id, 'notices.approved', { lpIds: targets, skipped });
  return { approved: targets.length, skipped };
}

/** Send a notice back to draft. Only possible while it has not gone out. */
export async function revertNotices(callId: string, lpIds: string[]) {
  const { call, user } = await loadAuthorised(callId);
  const service = createServiceSupabase();
  const investors = await investorIdsByLp(service, call.clientId, lpIds);

  const { error } = await service
    .from('notices')
    .update({ status: 'draft', approved_at: null, approved_by: null })
    .eq('call_id', callId)
    .in('investor_id', Object.values(investors))
    .neq('status', 'sent');
  if (error) throw new ActionError(error.message, 400);

  await audit(service, call, user.id, 'notices.reverted', { lpIds });
  return { reverted: lpIds.length };
}

/**
 * Send approved notices.
 *
 * Freezes a snapshot of the whole computed call first, then writes each
 * investor's notice exactly as it stood at that moment. Sending the first
 * notice locks the call, which the database enforces by trigger.
 */
export async function sendNotices(callId: string, lpIds?: string[]) {
  const { call, user } = await loadAuthorised(callId);

  const result = compute(call.model);
  if (result.checks.some((c) => c.level === 'fail')) {
    throw new ActionError('This call has failing checks and cannot be issued.', 409);
  }

  // Only what is already approved may go out, so sending can never skip review.
  const { send: targets, skipped } = sendableLpIds(call.notices, lpIds);
  if (!targets.length) {
    throw new ActionError('No approved notices to send. Approve them first.', 400);
  }

  const service = createServiceSupabase();

  // The snapshot is the audit record: these figures, this engine, this moment.
  const { data: snapshot, error: snapshotError } = await service
    .from('call_results')
    .insert({
      call_id: callId,
      engine_version: ENGINE_VERSION,
      computed_by: user.id,
      totals: asJson(roundTotals(result.totals, result.d)),
      rows: asJson(result.rows),
      checks: asJson(result.checks),
      golden_diffs: asJson(result.goldenDiffs),
    })
    .select('id')
    .single();
  if (snapshotError) throw new ActionError(snapshotError.message, 400);

  const investors = await investorIdsByLp(service, call.clientId, targets);
  const now = new Date().toISOString();

  const rows = targets.map((lpId) => {
    const row = result.rows.find((r) => r.LP_ID === lpId)!;
    return {
      call_id: callId,
      investor_id: investors[lpId],
      status: 'sent',
      sent_at: now,
      sent_by: user.id,
      sent_to_email: (row.Contact_Email as string) || null,
      // Stored as rendered, not as a promise to re-render it the same way.
      payload: asJson(buildNotice(call.model, result, row)),
      result_id: snapshot.id,
    };
  });

  const { error } = await service
    .from('notices')
    .upsert(rows, { onConflict: 'call_id,investor_id' });
  if (error) throw new ActionError(error.message, 400);

  // Issued. Delivery is attempted next, and is deliberately after this: the
  // record of what the fund called must not depend on whether a mail provider
  // was reachable, and a failed delivery has to be retryable without issuing
  // the call again — which is impossible, by design.
  const delivery = await deliverNotices(service, call, result, targets, investors);

  await audit(service, call, user.id, 'notices.sent', {
    lpIds: targets,
    skipped,
    snapshotId: snapshot.id,
    engineVersion: ENGINE_VERSION,
    delivered: delivery.delivered,
    failed: delivery.failed,
  });

  return {
    sent: targets.length,
    skipped,
    snapshotId: snapshot.id,
    delivered: delivery.delivered,
    failed: delivery.failed,
    errors: delivery.errors,
  };
}

/**
 * Email each issued notice, and record what happened against it.
 *
 * Every outcome is written, including the failures. A notice whose email did
 * not arrive is worse than one never issued, so it has to be visible rather
 * than swallowed — the Notices tab reads these columns and offers a retry.
 */
async function deliverNotices(
  service: ReturnType<typeof createServiceSupabase>,
  call: Awaited<ReturnType<typeof loadAuthorised>>['call'],
  result: ComputeResult,
  targets: string[],
  investors: Record<string, string>,
): Promise<{ delivered: number; failed: number; errors: string[] }> {
  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];
  const attemptedAt = new Date().toISOString();

  // Every send is going to one test address, so what the register holds — or
  // does not hold — cannot reach an investor.
  const redirected = Boolean(emailEnv()?.overrideTo);

  for (const lpId of targets) {
    const row = result.rows.find((r) => r.LP_ID === lpId)!;
    const address = String(row.Contact_Email ?? '').trim();

    let outcome: {
      email_status: 'delivered' | 'failed';
      email_message_id: string | null;
      email_error: string | null;
      email_delivered_to: string | null;
    };

    // A missing address only stops a send that would have gone to the investor.
    // While the override is in force nothing goes to them anyway, so refusing
    // here would block the very testing the override exists to make safe.
    if (!address && !redirected) {
      // Not a provider failure, and worth saying so precisely: nobody put an
      // address in the register.
      outcome = {
        email_status: 'failed',
        email_message_id: null,
        email_error: `No Contact_Email for ${lpId}.`,
        email_delivered_to: null,
      };
    } else {
      const notice = buildNotice(call.model, result, row);
      const pdf = await renderNoticePdf(notice, 'sent', attemptedAt);
      // `deliver` replaces this with the override when one is set; passing the
      // empty string is only reached in that case.
      const sent = await deliver(noticeEmail(notice, pdf, address));

      outcome = sent.ok
        ? {
            email_status: 'delivered',
            email_message_id: sent.messageId,
            email_error: null,
            email_delivered_to: sent.deliveredTo,
          }
        : {
            email_status: 'failed',
            email_message_id: null,
            email_error: sent.error,
            email_delivered_to: sent.deliveredTo,
          };
    }

    if (outcome.email_status === 'delivered') delivered += 1;
    else {
      failed += 1;
      errors.push(`${lpId}: ${outcome.email_error}`);
    }

    await service
      .from('notices')
      .update({ ...outcome, email_attempted_at: attemptedAt })
      .eq('call_id', call.id)
      .eq('investor_id', investors[lpId]);
  }

  return { delivered, failed, errors };
}

/**
 * Round fund totals before they are stored.
 *
 * Totals are sums of already-rounded per-investor figures, so binary floating
 * point leaves a trace: 7,037,500 arrives as 7037500.000000001. Harmless on
 * screen, where everything is formatted to the cent — but this is the audit
 * record of what a fund called, and it should read as the figure that was
 * called.
 */
function roundTotals(totals: ComputeResult['totals'], decimals: number): ComputeResult['totals'] {
  return {
    ...totals,
    Commitment: round(totals.Commitment, decimals),
    openUCC: round(totals.openUCC, decimals),
    openPaid: round(totals.openPaid, decimals),
    comps: totals.comps.map((c) => round(c, decimals)),
    feeGross: round(totals.feeGross, decimals),
    feeOffset: round(totals.feeOffset, decimals),
    feeNet: round(totals.feeNet, decimals),
    total: round(totals.total, decimals),
    reduces: round(totals.reduces, decimals),
    closingUCC: round(totals.closingUCC, decimals),
    closingPaid: round(totals.closingPaid, decimals),
  };
}

/** Map LP_IDs to investor ids for one fund. */
async function investorIdsByLp(
  service: ReturnType<typeof createServiceSupabase>,
  clientId: string,
  lpIds: string[],
): Promise<Record<string, string>> {
  const { data, error } = await service
    .from('investors')
    .select('id, lp_id')
    .eq('client_id', clientId)
    .in('lp_id', lpIds);
  if (error) throw new ActionError(error.message, 400);

  const missing = lpIds.filter((id) => !data?.some((i) => i.lp_id === id));
  if (missing.length) {
    throw new ActionError(`Not in the register: ${missing.join(', ')}.`, 400);
  }

  return Object.fromEntries((data ?? []).map((i) => [i.lp_id, i.id]));
}

async function audit(
  service: ReturnType<typeof createServiceSupabase>,
  call: Awaited<ReturnType<typeof loadAuthorised>>['call'],
  actor: string,
  action: string,
  after: Record<string, unknown>,
) {
  const { data: client } = await service
    .from('clients')
    .select('firm_id')
    .eq('id', call.clientId)
    .single();

  await service.from('audit_log').insert({
    firm_id: client?.firm_id ?? null,
    client_id: call.clientId,
    call_id: call.id,
    actor,
    action,
    entity_type: 'notice',
    after: asJson(after),
  });
}

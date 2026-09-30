/**
 * Finalising a closing, settling its equalization, and sending its statements.
 *
 * The same rules as approving and sending a call. The browser says which
 * closing or which period; the server reads the record as the signed-in user,
 * recomputes every figure from it, refuses over a failing check, and writes
 * with the service role — because nothing that fixes a figure may originate in
 * a browser.
 */

import {
  equalizationForStatement,
  equalizationInputFor,
  equalize,
  firstClosing,
  fmtDate,
  paymentInstructions,
  serialToISO,
  settlementConflict,
  suggestedStatementDueDate,
  termsOn,
  type EqualizationResult,
  type FundHistory,
  type Settlement,
} from '@/engine';
import { createServiceSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import type { Json } from '@/adapters/storage/database.types';
import { userSupabase, type UserSupabase } from './session';
import { ENGINE_VERSION } from './engine-version';
import { renderStatementPdf, statementFileName, type StatementInput } from './statement-pdf';
import { statementEmail } from './statement-email';
import { deliver } from './email';
import { emailEnv } from '@/lib/env';
import { ActionError } from './call-actions';

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

/**
 * Signed in, and the fund's record read as them: row-level security decides
 * what they can see. Reading needs nothing more; changing needs `canWrite`.
 */
async function readFund(fundId: string, client?: UserSupabase) {
  const userClient = await userSupabase(client);
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) throw new ActionError('You are not signed in.', 401);

  const repo = createSupabaseRepository(userClient as unknown as SupabaseClient);
  const [terms, closings, calls, fund] = await Promise.all([
    repo.listFundTerms(fundId),
    repo.listClosings(fundId),
    repo.listIssuedCalls(fundId),
    userClient.from('funds').select('client_id, name').eq('id', fundId).maybeSingle(),
  ]);
  if (!fund.data) throw new ActionError('That fund could not be found.', 404);
  const history: FundHistory = { terms, closings, calls };
  return {
    user,
    userClient,
    repo,
    history,
    closings,
    clientId: fund.data.client_id as string,
    fundName: fund.data.name as string,
  };
}

/** As `readFund`, and refused unless they can change this fund. */
async function loadFund(fundId: string, client?: UserSupabase) {
  const fund = await readFund(fundId, client);
  const { data: canWrite } = await fund.userClient.rpc('auth_can_write_fund', { target_fund: fundId });
  if (!canWrite) throw new ActionError('You do not have permission to change this fund.', 403);
  return fund;
}

/** A later closing's equalization, or null for the first close. */
export function equalizationFor(history: FundHistory, closingId: string): EqualizationResult | null {
  const input = equalizationInputFor(history, closingId);
  if (!input) return null;
  const decimals = termsOn(history.terms, input.closingDate)?.roundingDecimals ?? 2;
  return equalize({ ...input, decimals });
}

/** True when an equalization moves money for anyone, and so needs settling. */
const needsSettling = (result: EqualizationResult | null) => Boolean(result?.lines.some((l) => l.net !== 0));

const SETTLEMENTS: readonly Settlement[] = ['on_closing', 'next_call'];

export async function finaliseClosing(
  fundId: string,
  closingId: string,
  options: { client?: UserSupabase; settlement?: Settlement | null } = {},
) {
  const { user, history, closings, clientId } = await loadFund(fundId, options.client);
  const closing = closings.find((c) => c.id === closingId);
  if (!closing) throw new ActionError('That closing could not be found.', 404);
  if (closing.finalised) throw new ActionError('That closing is already finalised.', 409);
  if (!closing.commitments.length) throw new ActionError('Nobody is committing at this closing yet.', 400);

  // An earlier draft left open would change who counts as "already in".
  const first = firstClosing(history);
  const earlierDraft = closings.find((c) => !c.finalised && c.id !== closingId && c.closingDate < closing.closingDate);
  if (earlierDraft) {
    throw new ActionError(`Finalise closing ${earlierDraft.closingNo} first: it comes before this one.`, 409);
  }
  if (first && first.id !== closingId && !first.finalised) {
    throw new ActionError('Finalise the first close before a later one.', 409);
  }

  // Fees from this close, and its equalization, are worked out from the terms in
  // force on its date. With none, they would quietly come out as nothing.
  if (!termsOn(history.terms, closing.closingDate)) {
    const first = [...history.terms].sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom))[0];
    throw new ActionError(
      first
        ? `The fund's terms start on ${fmtDate(first.effectiveFrom)}, after this closing (${fmtDate(closing.closingDate)}). Record them from the closing date or earlier, then finalise.`
        : 'Record the fund’s terms before finalising a closing: its fees and equalization are worked out from them.',
      409,
    );
  }

  const result = equalizationFor(history, closingId);
  const failing = result?.checks.filter((c) => c.level === 'fail') ?? [];
  if (failing.length) throw new ActionError(failing.map((c) => c.text).join(' '), 409);

  // Money moves, so something must ask for it: statements now, or the next call.
  const settlement = needsSettling(result) ? (options.settlement ?? null) : null;
  if (needsSettling(result) && !settlement) {
    throw new ActionError('Choose how the equalization is settled: statements now, or on the next capital call.', 400);
  }
  if (settlement && !SETTLEMENTS.includes(settlement)) throw new ActionError('That is not a way to settle an equalization.', 400);
  const conflict = settlement && settlementConflict(
    history.closings.map((c) => (c.id === closingId ? { ...c, finalised: true } : c)),
    (id) => history.calls.some((call) => call.equalizationSchedule?.some((e) => e.closingId === id)),
    closingId,
    settlement,
  );
  if (conflict) throw new ActionError(conflict, 409);

  const service = createServiceSupabase();
  const { error } = await service.rpc('finalise_closing', {
    p_closing_id: closingId,
    p_result: result ? asJson(result) : (null as unknown as Json),
    p_engine_version: ENGINE_VERSION,
    p_user: user.id,
    p_settlement: settlement as string,
  });
  if (error) throw new ActionError(error.message, 400);

  await service.from('audit_log').insert({
    client_id: clientId,
    fund_id: fundId,
    actor: user.id,
    action: 'closing.finalised',
    entity_type: 'closing',
    entity_id: closingId,
    after: asJson({
      closingNo: closing.closingNo,
      closingDate: closing.closingDate,
      admitted: closing.commitments.map((k) => ({ lpId: k.lpId, amount: k.amount })),
      moved: result?.totals.moved ?? 0,
      settlement,
      engineVersion: ENGINE_VERSION,
    }),
  });

  return { finalised: true, moved: result?.totals.moved ?? 0, settlement };
}

/**
 * Choose, or change, how a finalised closing's equalization is settled.
 *
 * The figures are fixed; this only says which document asks for the cash. It
 * can change until a sent call has settled part of it — the database refuses
 * after that too, since the service role would otherwise get past it.
 */
export async function setClosingSettlement(
  fundId: string,
  closingId: string,
  settlement: Settlement,
  options: { client?: UserSupabase } = {},
) {
  const { user, history, closings, clientId } = await loadFund(fundId, options.client);
  if (!SETTLEMENTS.includes(settlement)) throw new ActionError('That is not a way to settle an equalization.', 400);
  const closing = closings.find((c) => c.id === closingId);
  if (!closing) throw new ActionError('That closing could not be found.', 404);
  if (!closing.finalised) throw new ActionError('Choose it when finalising the closing.', 409);
  if (!needsSettling(closing.result)) throw new ActionError('This closing moves no money, so there is nothing to settle.', 409);
  if (closing.settlement === settlement) return { settlement };

  const settledOn = history.calls.filter((c) => c.equalizationSchedule?.some((e) => e.closingId === closingId));
  if (settledOn.length) {
    throw new ActionError(
      `Closing ${closing.closingNo}'s equalization was settled on Call No. ${settledOn.map((c) => c.callNo).join(', ')}, which has been sent; how it is settled cannot change.`,
      409,
    );
  }

  const conflict = settlementConflict(
    history.closings,
    (id) => history.calls.some((call) => call.equalizationSchedule?.some((e) => e.closingId === id)),
    closingId,
    settlement,
  );
  if (conflict) throw new ActionError(conflict, 409);

  const service = createServiceSupabase();
  const { data: statements, error: readError } = await service.from('closing_statements').select('status').eq('closing_id', closingId);
  if (readError) throw new ActionError(readError.message, 400);
  if ((statements ?? []).some((r) => r.status === 'sent')) {
    throw new ActionError(`Closing ${closing.closingNo}'s statements have been sent; how it is settled cannot change.`, 409);
  }

  const { error } = await service.from('closings').update({ settlement }).eq('id', closingId);
  if (error) throw new ActionError(error.message, 409);
  // Statements approved but not sent would ask for money the next call now asks for.
  if (settlement !== 'on_closing' && statements?.length) {
    const { error: clearError } = await service.from('closing_statements').delete().eq('closing_id', closingId).neq('status', 'sent');
    if (clearError) throw new ActionError(clearError.message, 400);
  }

  await service.from('audit_log').insert({
    client_id: clientId,
    fund_id: fundId,
    actor: user.id,
    action: 'closing.settlement_chosen',
    entity_type: 'closing',
    entity_id: closingId,
    before: asJson({ settlement: closing.settlement ?? null }),
    after: asJson({ closingNo: closing.closingNo, settlement }),
  });
  return { settlement };
}

/**
 * One investor's equalization statement.
 *
 * A finalised closing prints what was frozen when it was finalised; a draft
 * prints the figures worked out now, stamped DRAFT.
 */
/** The statement exactly as it was sent to one investor, if it was. Read as the user: RLS decides. */
async function sentStatement(userClient: UserSupabase, closingId: string, lpId: string): Promise<StatementInput | null> {
  const { data, error } = await userClient
    .from('closing_statements')
    .select('payload, investors!inner ( lp_id )')
    .eq('closing_id', closingId)
    .eq('status', 'sent')
    .eq('investors.lp_id', lpId)
    .maybeSingle();
  if (error) throw new ActionError(error.message, 400);
  return (data?.payload as unknown as StatementInput | undefined) ?? null;
}

/** The payment due date a closing's statements were approved with, if any were. Read as the user. */
async function approvedDueDate(userClient: UserSupabase, closingId: string): Promise<string | null> {
  const { data, error } = await userClient
    .from('closing_statements')
    .select('payment_due_date')
    .eq('closing_id', closingId)
    .not('payment_due_date', 'is', null)
    .limit(1)
    .maybeSingle();
  if (error) throw new ActionError(error.message, 400);
  return data?.payment_due_date ?? null;
}

export async function statementFor(fundId: string, closingId: string, lpId: string, options: { client?: UserSupabase } = {}) {
  const { history, closings, fundName, userClient } = await readFund(fundId, options.client);
  const closing = closings.find((c) => c.id === closingId);
  if (!closing) throw new ActionError('That closing could not be found.', 404);

  const result = closing.finalised ? closing.result : equalizationFor(history, closingId);
  if (!result) throw new ActionError('The first close has nothing to equalize, so it has no statements.', 404);
  const line = result.lines.find((l) => l.lpId === lpId);
  if (!line) throw new ActionError(`${lpId} is not part of this closing's equalization.`, 404);

  // A statement that was sent is served as it was sent, not written again from
  // today's terms — the investor's copy and ours must be the same document.
  const sent = await sentStatement(userClient, closingId, lpId);
  if (sent) return { pdf: await renderStatementPdf(sent), fileName: statementFileName(closing.closingNo, line.name) };

  const payment = paymentInstructions(termsOn(history.terms, closing.closingDate), {
    lpId,
    callNo: `EQ${closing.closingNo}`,
  });
  // Settled by statement, it is payable by the date chosen at approval — or,
  // before that, the date that would be suggested — and interest runs to it.
  const dueDate =
    closing.finalised && closing.settlement === 'on_closing'
      ? ((await approvedDueDate(userClient, closingId)) ?? suggestedStatementDueDate(closing.closingDate))
      : null;
  const shown = dueDate ? equalizationForStatement(result, dueDate) : result;
  const pdf = await renderStatementPdf({
    fund: fundName,
    closingNo: closing.closingNo,
    line: shown.lines.find((l) => l.lpId === lpId)!,
    result: shown,
    finalised: closing.finalised,
    payment,
    dueDate,
    settlement: closing.settlement ?? null,
  });
  return { pdf, fileName: statementFileName(closing.closingNo, line.name) };
}

// ---------------------------------------------------------------------------
// Equalization statements: a closing settled on the closing
// ---------------------------------------------------------------------------

type Service = ReturnType<typeof createServiceSupabase>;

/**
 * The closing, refused unless its equalization is settled by statement, and
 * which investors get one: everyone whose equalization moves money.
 */
async function statementClosing(fundId: string, closingId: string, client?: UserSupabase) {
  const fund = await loadFund(fundId, client);
  const closing = fund.closings.find((c) => c.id === closingId);
  if (!closing) throw new ActionError('That closing could not be found.', 404);
  if (!closing.finalised || !closing.result) throw new ActionError('Only a finalised later closing has statements to send.', 409);
  if (closing.settlement !== 'on_closing') {
    throw new ActionError(
      closing.settlement === 'next_call'
        ? `Closing ${closing.closingNo} is settled on the next capital call, so no statement asks for the money.`
        : `Choose how Closing ${closing.closingNo}'s equalization is settled first.`,
      409,
    );
  }
  const owing = closing.result.lines.filter((l) => l.net !== 0).map((l) => l.lpId);
  const service = createServiceSupabase();
  const { data: rows, error } = await service
    .from('closing_statements')
    .select('id, status, investor_id, payment_due_date, investors!inner ( lp_id )')
    .eq('closing_id', closingId);
  if (error) throw new ActionError(error.message, 400);
  const statusOf = new Map(
    (rows ?? []).map((r) => [(r.investors as unknown as { lp_id: string }).lp_id, r.status as 'draft' | 'approved' | 'sent']),
  );
  // One closing, one date: the interest the earlier investors share is what
  // the late investors pay, so everyone's statement runs it to the same day.
  // It can change until the first statement is sent.
  const dueDate = (rows ?? []).find((r) => r.status !== 'draft' && r.payment_due_date)?.payment_due_date ?? null;
  const sentDueDate = (rows ?? []).find((r) => r.status === 'sent' && r.payment_due_date)?.payment_due_date ?? null;
  const anySent = (rows ?? []).some((r) => r.status === 'sent');
  return { ...fund, closing, result: closing.result, owing, statusOf, dueDate, sentDueDate, anySent, service };
}

async function investorIds(service: Service, fundId: string, lpIds: string[]) {
  const { data, error } = await service.from('investors').select('id, lp_id, contact_email, cc_emails').eq('fund_id', fundId).in('lp_id', lpIds);
  if (error) throw new ActionError(error.message, 400);
  return new Map((data ?? []).map((i) => [i.lp_id, i]));
}

/**
 * Approve the statements not yet approved or sent — all of them, or the
 * investors named — payable by `paymentDueDate`. Interest runs to that date
 * when the terms say so. Every statement of a closing has the same date: until
 * one is sent, a new date is put on those already approved too; once one is
 * sent, the rest must match it.
 */
export async function approveStatements(
  fundId: string,
  closingId: string,
  lpIds: string[] | undefined,
  paymentDueDate: string,
  options: { client?: UserSupabase } = {},
) {
  const { user, closing, owing, statusOf, dueDate, sentDueDate, anySent, service, clientId } = await statementClosing(fundId, closingId, options.client);
  const due = serialToISO(paymentDueDate);
  if (!due) throw new ActionError('Say the date the statements are payable by.', 400);
  if (due < closing.closingDate) {
    throw new ActionError(`The payment due date cannot be before the closing (${fmtDate(closing.closingDate)}).`, 400);
  }
  if (anySent && due !== sentDueDate) {
    throw new ActionError(
      sentDueDate
        ? `Closing ${closing.closingNo}'s statements already sent are payable by ${fmtDate(sentDueDate)}: the rest must be too, so the interest adds up.`
        : `Closing ${closing.closingNo}'s statements were sent before a payment date was recorded, so the rest cannot be given one. Settle the rest on the next call instead.`,
      409,
    );
  }
  const targets = owing.filter((id) => (!lpIds || lpIds.includes(id)) && !['approved', 'sent'].includes(statusOf.get(id) ?? 'draft'));
  // Approved, not sent, and payable by another date: they move to this one.
  const redated = dueDate && dueDate !== due ? owing.filter((id) => statusOf.get(id) === 'approved') : [];
  if (!targets.length && !redated.length) throw new ActionError('There are no statements left to approve.', 400);
  const ids = await investorIds(service, fundId, [...targets, ...redated]);
  const now = new Date().toISOString();
  if (redated.length) {
    const { error: redateError } = await service
      .from('closing_statements')
      .update({ payment_due_date: due, updated_at: now })
      .eq('closing_id', closingId)
      .eq('status', 'approved')
      .in('investor_id', redated.map((lpId) => ids.get(lpId)!.id));
    if (redateError) throw new ActionError(redateError.message, 400);
  }
  const { error } = targets.length ? await service.from('closing_statements').upsert(
    targets.map((lpId) => ({
      closing_id: closingId,
      investor_id: ids.get(lpId)!.id,
      status: 'approved',
      payment_due_date: due,
      approved_at: now,
      approved_by: user.id,
      updated_at: now,
    })),
    { onConflict: 'closing_id,investor_id' },
  ) : { error: null };
  if (error) throw new ActionError(error.message, 400);
  await service.from('audit_log').insert({
    client_id: clientId,
    fund_id: fundId,
    actor: user.id,
    action: 'statements.approved',
    entity_type: 'closing',
    entity_id: closingId,
    after: asJson({ closingNo: closing.closingNo, lpIds: targets, redated, paymentDueDate: due, previousDueDate: dueDate }),
  });
  return { approved: targets.length, redated: redated.length, paymentDueDate: due };
}

/**
 * Send the approved statements: each fixed as sent — the figures from the
 * frozen equalization, the payment instructions in force on the closing date —
 * then emailed. Issuing does not wait on email: a failed delivery is recorded
 * and can be retried, and the statement stays sent.
 */
export async function sendStatements(
  fundId: string,
  closingId: string,
  lpIds?: string[],
  options: { client?: UserSupabase; deliver?: boolean } = {},
) {
  const { user, closing, result, history, fundName, owing, statusOf, dueDate, service, clientId } = await statementClosing(fundId, closingId, options.client);
  const targets = owing.filter((id) => (!lpIds || lpIds.includes(id)) && statusOf.get(id) === 'approved');
  if (!targets.length) throw new ActionError('No approved statements to send. Approve them first.', 400);
  if (!dueDate) throw new ActionError('The approved statements have no payment due date. Approve them again with one.', 409);

  const { data: frozen, error: frozenError } = await service.from('closing_results').select('id').eq('closing_id', closingId).single();
  if (frozenError) throw new ActionError(frozenError.message, 400);

  const ids = await investorIds(service, fundId, targets);
  const terms = termsOn(history.terms, closing.closingDate);
  // The frozen equalization, with interest run to the date it is payable by.
  const asked = equalizationForStatement(result, dueDate);
  const input = (lpId: string): StatementInput => ({
    fund: fundName,
    closingNo: closing.closingNo,
    line: asked.lines.find((l) => l.lpId === lpId)!,
    result: asked,
    finalised: true,
    payment: paymentInstructions(terms, { lpId, callNo: `EQ${closing.closingNo}` }),
    dueDate,
    settlement: 'on_closing',
  });

  // Each row moves from approved to sent only if it is still approved, and only
  // the rows that moved are emailed and counted: a second press of Send, or a
  // retried request, finds nothing left to move and emails nobody again.
  const now = new Date().toISOString();
  const moved: string[] = [];
  for (const lpId of targets) {
    const { data, error } = await service
      .from('closing_statements')
      .update({
        status: 'sent',
        sent_at: now,
        sent_by: user.id,
        sent_to_email: ids.get(lpId)!.contact_email ?? null,
        payload: asJson(input(lpId)),
        result_id: frozen.id,
        updated_at: now,
      })
      .eq('closing_id', closingId)
      .eq('investor_id', ids.get(lpId)!.id)
      .eq('status', 'approved')
      .select('id');
    if (error) {
      // Whatever already moved is sent: record it before refusing the rest.
      await auditSent(moved, { failedAt: lpId, error: error.message });
      throw new ActionError(`${moved.length ? `${moved.length} sent, then ` : ''}${lpId} could not be sent: ${error.message}`, 400);
    }
    if (data?.length) moved.push(lpId);
  }
  if (!moved.length) throw new ActionError('Those statements have already been sent.', 409);

  const delivery =
    options.deliver === false ? { delivered: 0, failed: 0, errors: [] as string[] } : await deliverStatements(service, closingId, moved, ids, input);

  await auditSent(moved, { delivered: delivery.delivered, failed: delivery.failed, emailed: options.deliver !== false });
  return { sent: moved.length, ...delivery };

  async function auditSent(lpIds: string[], extra: Record<string, unknown>) {
    if (!lpIds.length) return;
    await service.from('audit_log').insert({
      client_id: clientId,
      fund_id: fundId,
      actor: user.id,
      action: 'statements.sent',
      entity_type: 'closing',
      entity_id: closingId,
      after: asJson({ closingNo: closing.closingNo, lpIds, resultId: frozen!.id, ...extra }),
    });
  }
}

/** Email sent statements again whose delivery failed. What was sent does not change. */
export async function retryStatementDelivery(fundId: string, closingId: string, options: { client?: UserSupabase } = {}) {
  const { user, closing, service, clientId } = await statementClosing(fundId, closingId, options.client);
  const { data: failed, error } = await service
    .from('closing_statements')
    .select('payload, investors!inner ( lp_id )')
    .eq('closing_id', closingId)
    .eq('status', 'sent')
    .eq('email_status', 'failed');
  if (error) throw new ActionError(error.message, 400);
  const payloads = new Map(
    (failed ?? []).map((r) => [(r.investors as unknown as { lp_id: string }).lp_id, r.payload as unknown as StatementInput]),
  );
  const targets = [...payloads.keys()];
  if (!targets.length) throw new ActionError('No statement emails have failed.', 400);
  const ids = await investorIds(service, fundId, targets);
  // The statement as it was sent, not as it would be written today.
  const delivery = await deliverStatements(service, closingId, targets, ids, (lpId) => payloads.get(lpId)!);
  await service.from('audit_log').insert({
    client_id: clientId,
    fund_id: fundId,
    actor: user.id,
    action: 'statements.redelivered',
    entity_type: 'closing',
    entity_id: closingId,
    after: asJson({ closingNo: closing.closingNo, lpIds: targets, delivered: delivery.delivered, failed: delivery.failed }),
  });
  return delivery;
}

async function deliverStatements(
  service: Service,
  closingId: string,
  targets: string[],
  ids: Map<string, { id: string; contact_email: string | null; cc_emails: string[] | null }>,
  input: (lpId: string) => StatementInput,
): Promise<{ delivered: number; failed: number; errors: string[] }> {
  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];
  const attemptedAt = new Date().toISOString();
  // Under the override nothing reaches an investor, so a missing address does not stop a test send.
  const redirected = Boolean(emailEnv()?.overrideTo);

  for (const lpId of targets) {
    const investor = ids.get(lpId)!;
    const address = String(investor.contact_email ?? '').trim();
    let outcome: { email_status: 'delivered' | 'failed'; email_message_id: string | null; email_error: string | null; email_delivered_to: string | null };
    if (!address && !redirected) {
      outcome = { email_status: 'failed', email_message_id: null, email_error: `No notices email for ${lpId}.`, email_delivered_to: null };
    } else {
      const s = input(lpId);
      const pdf = await renderStatementPdf(s);
      const sent = await deliver(statementEmail(s, pdf, address, investor.cc_emails ?? []));
      outcome = sent.ok
        ? { email_status: 'delivered', email_message_id: sent.messageId, email_error: null, email_delivered_to: sent.deliveredTo }
        : { email_status: 'failed', email_message_id: null, email_error: sent.error, email_delivered_to: sent.deliveredTo };
    }
    if (outcome.email_status === 'delivered') delivered++;
    else {
      failed++;
      errors.push(`${lpId}: ${outcome.email_error}`);
    }
    await service
      .from('closing_statements')
      .update({ ...outcome, email_attempted_at: attemptedAt, updated_at: attemptedAt })
      .eq('closing_id', closingId)
      .eq('investor_id', investor.id);
  }
  return { delivered, failed, errors };
}

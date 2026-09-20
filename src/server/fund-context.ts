/**
 * The JSON the model is given to answer from.
 *
 * Built on the server, from the database, every time a question is asked. Two
 * consequences, both deliberate:
 *
 *  - The browser never holds the register. Asking "who has no contact email"
 *    does not require shipping every investor's address to the client first.
 *  - The figures are recomputed rather than remembered, so an answer can never
 *    cite a number the screen no longer shows.
 *
 * Everything here is read. Nothing in this file can change a call.
 */

import { compute, num, serialToISO } from '@/engine';
import type { CallDetail, Client, NoticeState, NoticeStatus } from '@/adapters/storage/types';

/** Roughly the point past which a snapshot stops fitting in a request. */
const MAX_CHARS = 400_000;

export interface FundContext {
  client: string;
  today: string;
  /** Present only when older calls had to be dropped to fit. */
  omitted?: string;
  calls: unknown[];
}

export function buildFundContext(client: Client, calls: CallDetail[]): FundContext {
  // Newest first, so the trim below drops the oldest — a question is almost
  // always about the call in hand.
  const ordered = [...calls].sort((a, b) => b.callNo - a.callNo);
  const described = ordered.map(describeCall);

  const context: FundContext = {
    client: client.name,
    today: new Date().toISOString().slice(0, 10),
    calls: described,
  };

  // A fund with a long history can outgrow one request. Dropping the oldest
  // calls and saying so is better than a request that is rejected whole, and
  // far better than silently sending half the data as if it were all of it.
  while (context.calls.length > 1 && JSON.stringify(context).length > MAX_CHARS) {
    context.calls = context.calls.slice(0, -1);
    const dropped = described.length - context.calls.length;
    context.omitted = `${dropped} older call${dropped === 1 ? '' : 's'} omitted — this snapshot covers the ${context.calls.length} most recent.`;
  }

  return context;
}

function describeCall(call: CallDetail) {
  const result = compute(call.model);
  const notices = new Map(call.notices.map((n) => [n.lpId, n]));

  return {
    call_number: call.callNo,
    stage: call.stage,
    notice_date: serialToISO(call.model.setup.Call_Date),
    payment_due: serialToISO(call.model.setup.Payment_Due_Date),
    input_source: call.sourceFileName ?? 'manual',
    setup: call.model.setup,
    fee_config: call.model.fee,
    components: call.model.components,
    transfers: call.model.transfers,
    allocation: result.rows.map((r) => ({
      LP_ID: r.LP_ID,
      LP_Name: r.LP_Name,
      Status: r.Status,
      Commitment: num(r.Commitment),
      Opening_UCC: r.openUCC,
      Opening_Paid_In: r.openPaid,
      Fee_Exempt: r.Fee_Exempt,
      Mgmt_Fee_Rate_Override: r.Mgmt_Fee_Rate_Override,
      Side_Letter_Ref: r.Side_Letter_Ref,
      Contact_Email: r.Contact_Email,
      Notes: r.Notes,
      components: Object.fromEntries(
        r.comps.map((c) => [c.name, c.excused ? 'excused' : c.amt]),
      ),
      Fee_Rate: r.feeRate,
      Fee_Gross: r.feeGross,
      Fee_Offset: r.feeOffset,
      Fee_Net: r.feeNet,
      Total_Call: r.total,
      Reduces_Unfunded: r.reduces,
      Closing_UCC: r.closingUCC,
      Closing_Paid_In: r.closingPaid,
      notice_status: noticeStatus(notices.get(r.LP_ID)),
      notice_sent_at: notices.get(r.LP_ID)?.sentAt ?? null,
    })),
    totals: result.totals,
    checks: result.checks,
    expected_output_differences: result.goldenDiffs,
    // Counted here rather than left for the model to work out by scanning the
    // rows. It got this wrong twice: once by counting a different call's rows,
    // and once by repeating its own earlier count after a notice was approved
    // mid-conversation. A number it can read cannot be miscounted.
    notice_summary: summarise(result.rows.filter((r) => r.isActive), notices),
  };
}

function summarise(
  rows: { LP_ID: string }[],
  notices: Map<string, NoticeState>,
) {
  const of = (status: NoticeStatus) =>
    rows.filter((r) => noticeStatus(notices.get(r.LP_ID)) === status).map((r) => r.LP_ID);

  const draft = of('draft');
  const approved = of('approved');
  const sent = of('sent');

  return {
    active_investors: rows.length,
    draft: draft.length,
    approved: approved.length,
    sent: sent.length,
    draft_lps: draft,
    approved_lps: approved,
    sent_lps: sent,
  };
}

/** An investor with no notice row yet is a draft, as everywhere else. */
function noticeStatus(notice: NoticeState | undefined) {
  return notice?.status ?? 'draft';
}

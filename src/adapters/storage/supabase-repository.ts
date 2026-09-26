/**
 * `CallRepository` backed by Supabase.
 *
 * Reads go through PostgREST with row-level security applied. The one write —
 * saving a call's inputs — goes through the `save_call_inputs` function, so a
 * save that fails partway cannot leave a call with a new register and stale
 * components.
 *
 * Nothing here approves, sends or freezes. Those are privileged and live in
 * route handlers holding the service role.
 */

import { issuedCallFrom, num } from '@/engine';
import type { InvestorPatch, KycStatus } from './types';
import type { EqualizationDueEntry, FeeScheduleEntry } from '@/engine/types';
import type { Settlement } from '@/engine/fund-history';
import type { Database } from './database.types';
import type { FundProgress } from '@/lib/fund-gates';
import type { CallModel } from '@/engine/types';
import type { FundTerms } from '@/engine/fund-terms';
import type { EqualizationResult } from '@/engine/equalization';
import type { IssuedCall } from '@/engine/positions';
import type { ComputedRow } from '@/engine/types';
import {
  fromCallModel,
  fromComponentRow,
  fromIdList,
  fromLPRow,
  fromLPRowIdentity,
  fromOffsetRow,
  fromFundTerms,
  fromTransferRow,
  toCallModel,
  toFundTerms,
  toNumber,
  toSources,
  type CallParts,
} from './mappers';
import type { SupabaseClient } from './supabase-client';
import type {
  CallDetail,
  CallRepository,
  CallSources,
  CallStage,
  CallSummary,
  Fund,
  Closing,
  ClosingCommitmentInput,
  ClosingStatement,
  FundInvestor,
  FundPosition,
  NoticeState,
  NoticeStatus,
} from './types';

/** Columns of `call_register` plus the joined investor, as PostgREST names them. */
const REGISTER_SELECT = `
  id, call_id, investor_id, commitment, opening_paid_in, opening_ucc,
  opening_invested_capital, mgmt_fee_rate_override, fee_exempt, status, position,
  investors!inner ( id, lp_id, lp_name, lp_type, contact_email, side_letter_ref, notes )
`;

const INVESTOR_SELECT = 'id, lp_id, lp_name, lp_type, contact_email, cc_emails, country, is_gp, kyc_status, side_letter_ref, notes';

type InvestorRow = {
  id: string;
  lp_id: string;
  lp_name: string;
  lp_type: string;
  contact_email: string | null;
  cc_emails: string[];
  country: string | null;
  is_gp: boolean;
  kyc_status: string;
  side_letter_ref: string | null;
  notes: string | null;
};

function toInvestor(r: InvestorRow): FundInvestor {
  return {
    id: r.id,
    lpId: r.lp_id,
    name: r.lp_name,
    type: r.lp_type,
    email: r.contact_email,
    ccEmails: r.cc_emails ?? [],
    country: r.country,
    isGp: r.is_gp,
    kycStatus: r.kyc_status as KycStatus,
    sideLetterRef: r.side_letter_ref,
    notes: r.notes,
  };
}

/** The columns an investor patch writes. A blank text field is stored as null; an absent one is left alone. */
function fromInvestorPatch(p: InvestorPatch): Database['public']['Tables']['investors']['Update'] {
  const blank = (v: string | null) => v?.trim() || null;
  return {
    ...(p.name !== undefined && { lp_name: p.name.trim() }),
    ...(p.type !== undefined && { lp_type: p.type.trim() || 'LP' }),
    ...(p.email !== undefined && { contact_email: blank(p.email) }),
    ...(p.ccEmails !== undefined && { cc_emails: p.ccEmails.map((e) => e.trim()).filter(Boolean) }),
    ...(p.country !== undefined && { country: blank(p.country) }),
    ...(p.isGp !== undefined && { is_gp: p.isGp }),
    ...(p.kycStatus !== undefined && { kyc_status: p.kycStatus }),
    ...(p.sideLetterRef !== undefined && { side_letter_ref: blank(p.sideLetterRef) }),
    ...(p.notes !== undefined && { notes: blank(p.notes) }),
  };
}

export function createSupabaseRepository(db: SupabaseClient): CallRepository {
  return {
    async listFunds(): Promise<Fund[]> {
      const { data, error } = await db
        .from('funds')
        .select('id, name')
        .is('archived_at', null)
        .order('name');
      if (error) throw asError(error, 'load the fund list');
      return data ?? [];
    },

    async createFund(name: string): Promise<Fund> {
      // A client must exist to own the fund. Where a user belongs to several,
      // this takes the first — a client picker is a later concern.
      const { data: clients, error: clientError } = await db.from('clients').select('id').limit(1);
      if (clientError) throw asError(clientError, 'find your client');
      if (!clients?.length) {
        throw new Error('You are not a member of any client yet, so there is nowhere to put this fund.');
      }

      const { data, error } = await db
        .from('funds')
        .insert({ client_id: clients[0].id, name })
        .select('id, name')
        .single();
      if (error) throw asError(error, `create the fund "${name}"`);
      return data;
    },

    async deleteFund(fundId: string): Promise<void> {
      const { error } = await db.from('funds').delete().eq('id', fundId);
      if (error) throw asError(error, 'delete this fund');
    },

    async getFundPosition(fundId: string): Promise<FundPosition | null> {
      const { data, error } = await db
        .from('fund_positions')
        .select('*')
        .eq('fund_id', fundId)
        .maybeSingle();
      if (error) throw asError(error, 'load the fund position');
      if (!data) return null;
      return {
        fundId: data.fund_id as string,
        name: data.name as string,
        totalCommitments: toNumber(data.total_commitments),
        paidInCapital: toNumber(data.paid_in_capital),
        investors: toNumber(data.investors),
        callsIssued: toNumber(data.calls_issued),
        calledToDate: toNumber(data.called_to_date),
        calledAgainstCommitment: toNumber(data.called_against_commitment),
        unfundedCommitment: toNumber(data.unfunded_commitment),
        latestCallNo: data.latest_call_no ?? null,
        nextPaymentDue: data.next_payment_due ?? null,
      };
    },

    async getFundProgress(fundId: string): Promise<FundProgress> {
      const count = { count: 'exact' as const, head: true };
      const [terms, investors, closings, finalised, calls] = await Promise.all([
        db.from('fund_terms').select('fund_id', count).eq('fund_id', fundId),
        db.from('investors').select('id', count).eq('fund_id', fundId),
        db.from('closings').select('id', count).eq('fund_id', fundId),
        db.from('closings').select('id', count).eq('fund_id', fundId).not('finalised_at', 'is', null),
        db.from('calls').select('id', count).eq('fund_id', fundId),
      ]);
      const failed = [terms, investors, closings, finalised, calls].find((r) => r.error);
      if (failed?.error) throw asError(failed.error, "work out how far the fund has got");
      return {
        hasTerms: (terms.count ?? 0) > 0,
        investors: investors.count ?? 0,
        closings: closings.count ?? 0,
        finalisedClosings: finalised.count ?? 0,
        calls: calls.count ?? 0,
      };
    },

    async listFundTerms(fundId: string): Promise<FundTerms[]> {
      const { data, error } = await db
        .from('fund_terms')
        .select('*')
        .eq('fund_id', fundId)
        .order('effective_from')
        .order('created_at');
      if (error) throw asError(error, "load the fund's terms");
      return (data ?? []).map(toFundTerms);
    },

    async addFundTerms(fundId: string, rows: Omit<FundTerms, 'createdAt'>[]): Promise<FundTerms[]> {
      const { data, error } = await db
        .from('fund_terms')
        .insert(rows.map((row) => fromFundTerms(fundId, row)))
        .select('*');
      if (error) throw asError(error, "record the fund's terms");
      return (data ?? []).map(toFundTerms);
    },

    async listInvestors(fundId: string): Promise<FundInvestor[]> {
      const { data, error } = await db
        .from('investors')
        .select(INVESTOR_SELECT)
        .eq('fund_id', fundId)
        .order('lp_id');
      if (error) throw asError(error, "load the fund's investors");
      return (data ?? []).map(toInvestor);
    },

    async createInvestor(fundId: string, lpId: string, profile: InvestorPatch): Promise<FundInvestor> {
      const { data, error } = await db
        .from('investors')
        .insert({ ...fromInvestorPatch(profile), fund_id: fundId, lp_id: lpId.trim(), lp_name: profile.name?.trim() || lpId.trim() })
        .select(INVESTOR_SELECT)
        .single();
      if (error?.code === '23505') throw new Error(`${lpId} is already an investor in this fund.`);
      if (error) throw asError(error, `add ${lpId}`);
      return toInvestor(data);
    },

    async updateInvestor(investorId: string, patch: InvestorPatch): Promise<void> {
      const { error } = await db.from('investors').update(fromInvestorPatch(patch)).eq('id', investorId);
      if (error) throw asError(error, 'save the investor');
    },

    async listClosings(fundId: string): Promise<Closing[]> {
      const { data, error } = await db
        .from('closings')
        // One string literal: supabase-js types the row from the select.
        .select('id, closing_no, closing_date, note, finalised_at, settlement, closing_commitments ( investor_id, amount, fee_rate_override, fee_exempt, position, investors!inner ( lp_id, lp_name, contact_email ) ), closing_results ( result )')
        .eq('fund_id', fundId)
        .order('closing_date')
        .order('closing_no');
      if (error) throw asError(error, "load the fund's closings");
      return (data ?? []).map((c) => {
        const results = c.closing_results as unknown as { result: unknown } | { result: unknown }[] | null;
        const result = (Array.isArray(results) ? results[0]?.result : results?.result) ?? null;
        const rows = [...((c.closing_commitments as unknown as {
          investor_id: string;
          amount: string | number;
          fee_rate_override: string | number | null;
          fee_exempt: boolean;
          position: number;
          investors: { lp_id: string; lp_name: string; contact_email: string | null };
        }[]) ?? [])].sort((a, b) => a.position - b.position);
        return {
          id: c.id,
          closingNo: c.closing_no,
          closingDate: c.closing_date,
          note: c.note,
          finalisedAt: c.finalised_at,
          finalised: c.finalised_at !== null,
          result: result as EqualizationResult | null,
          settlement: c.settlement as Settlement | null,
          commitments: rows.map((r) => ({
            investorId: r.investor_id,
            lpId: r.investors.lp_id,
            name: r.investors.lp_name,
            contactEmail: r.investors.contact_email,
            amount: toNumber(r.amount),
            feeRateOverride: r.fee_rate_override === null ? null : toNumber(r.fee_rate_override),
            feeExempt: r.fee_exempt,
          })),
        };
      });
    },

    async createClosing(fundId: string, closingDate: string, note?: string | null): Promise<Closing> {
      const { data: last, error: lastError } = await db
        .from('closings')
        .select('closing_no')
        .eq('fund_id', fundId)
        .order('closing_no', { ascending: false })
        .limit(1);
      if (lastError) throw asError(lastError, 'work out the next closing number');
      const closingNo = (last?.[0]?.closing_no ?? 0) + 1;
      const { data, error } = await db
        .from('closings')
        .insert({ fund_id: fundId, closing_no: closingNo, closing_date: closingDate, note: note ?? null })
        .select('id')
        .single();
      if (error) throw asError(error, `draft closing ${closingNo}`);
      const all = await this.listClosings(fundId);
      return all.find((c) => c.id === data.id)!;
    },

    async updateClosing(closingId: string, patch: { closingDate?: string; note?: string | null }): Promise<void> {
      const { error } = await db
        .from('closings')
        .update({
          ...(patch.closingDate !== undefined ? { closing_date: patch.closingDate } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
        })
        .eq('id', closingId);
      if (error) throw asError(error, 'save the closing');
    },

    async deleteClosing(closingId: string): Promise<void> {
      const { error } = await db.from('closings').delete().eq('id', closingId);
      if (error) throw asError(error, 'delete the closing');
    },

    async saveClosingCommitments(closingId: string, rows: ClosingCommitmentInput[]): Promise<void> {
      const { error } = await db.rpc('save_closing_commitments', {
        p_closing_id: closingId,
        p_rows: rows
          .filter((r) => r.lpId.trim())
          .map((r, i) => ({
            lp_id: r.lpId.trim(),
            lp_name: r.name.trim(),
            contact_email: r.contactEmail?.trim() || null,
            amount: r.amount,
            fee_rate_override: r.feeRateOverride ?? null,
            fee_exempt: r.feeExempt ?? false,
            position: i,
          })),
      });
      if (error) throw asError(error, "save the closing's investors");
    },

    async listClosingStatements(fundId: string): Promise<ClosingStatement[]> {
      const { data, error } = await db
        .from('closing_statements')
        .select('closing_id, status, approved_at, sent_at, sent_to_email, email_status, email_error, email_delivered_to, investors!inner ( lp_id ), closings!inner ( fund_id )')
        .eq('closings.fund_id', fundId);
      if (error) throw asError(error, "load the closings' statements");
      return (data ?? []).map((r) => ({
        closingId: r.closing_id,
        lpId: (r.investors as unknown as { lp_id: string }).lp_id,
        status: r.status as ClosingStatement['status'],
        approvedAt: r.approved_at,
        sentAt: r.sent_at,
        sentToEmail: r.sent_to_email,
        emailStatus: r.email_status as ClosingStatement['emailStatus'],
        emailError: r.email_error,
        emailDeliveredTo: r.email_delivered_to,
      }));
    },

    async listIssuedCalls(fundId: string): Promise<IssuedCall[]> {
      const { data: calls, error } = await db
        .from('calls')
        .select('id, call_no, call_date, payment_due_date, fee_schedule, equalization_schedule')
        .eq('fund_id', fundId)
        .not('locked_at', 'is', null);
      if (error) throw asError(error, "load the fund's issued calls");
      if (!calls?.length) return [];
      const { data: results, error: resultError } = await db
        .from('call_results')
        .select('call_id, rows, computed_at')
        .in('call_id', calls.map((c) => c.id))
        .order('computed_at', { ascending: false });
      if (resultError) throw asError(resultError, 'load the frozen call figures');
      // The latest snapshot of each call is what it was sent as.
      const latest = new Map<string, unknown>();
      for (const r of results ?? []) if (!latest.has(r.call_id)) latest.set(r.call_id, r.rows);
      return calls
        .filter((c) => latest.has(c.id))
        .map((c) =>
          issuedCallFrom(
            c.call_no,
            c.call_date ?? '',
            c.payment_due_date ?? c.call_date ?? '',
            latest.get(c.id) as ComputedRow[],
            // What it billed and settled, frozen with it when it was sent.
            {
              fee: Array.isArray(c.fee_schedule) ? (c.fee_schedule as unknown as FeeScheduleEntry[]) : null,
              equalization: Array.isArray(c.equalization_schedule)
                ? (c.equalization_schedule as unknown as EqualizationDueEntry[])
                : null,
            },
          ),
        )
        .sort((a, b) => a.callDate.localeCompare(b.callDate) || a.callNo - b.callNo);
    },

    async listCalls(fundId: string): Promise<CallSummary[]> {
      const { data: calls, error } = await db
        .from('calls')
        .select('id, call_no, call_date, payment_due_date, locked_at')
        .eq('fund_id', fundId)
        .order('call_no', { ascending: false });
      if (error) throw asError(error, 'load the call history');
      if (!calls?.length) return [];

      const ids = calls.map((c) => c.id);

      // Stage and notice counts come from the view; totals from the frozen
      // snapshot, which only exists once a call has been issued.
      const [{ data: stages, error: stageError }, { data: results, error: resultError }] =
        await Promise.all([
          db.from('call_stages').select('*').in('call_id', ids),
          db.from('call_latest_result').select('call_id, totals').in('call_id', ids),
        ]);
      if (stageError) throw asError(stageError, 'load call stages');
      if (resultError) throw asError(resultError, 'load computed totals');

      const stageBy = new Map((stages ?? []).map((s) => [s.call_id as string, s]));
      const totalBy = new Map(
        (results ?? []).map((r) => [
          r.call_id as string,
          toNumber((r.totals as { total?: number } | null)?.total ?? null),
        ]),
      );

      return calls.map((c) => {
        const s = stageBy.get(c.id);
        return {
          id: c.id,
          callNo: c.call_no,
          callDate: c.call_date,
          paymentDueDate: c.payment_due_date,
          stage: (s?.stage as CallStage) ?? 'not_started',
          activeInvestors: toNumber(s?.active_investors ?? 0),
          noticesSent: toNumber(s?.notices_sent ?? 0),
          noticesApproved: toNumber(s?.notices_approved ?? 0),
          noticesDraft: toNumber(s?.notices_draft ?? 0),
          lockedAt: c.locked_at,
          totalCalled: totalBy.has(c.id) ? (totalBy.get(c.id) as number) : null,
        };
      });
    },

    async getCall(callId: string): Promise<CallDetail | null> {
      const { data: call, error } = await db
        .from('calls')
        .select('*')
        .eq('id', callId)
        .maybeSingle();
      if (error) throw asError(error, 'load the capital call');
      if (!call) return null;

      const [register, components, offsets, transfers, expected, stage, notices] =
        await Promise.all([
          db.from('call_register').select(REGISTER_SELECT).eq('call_id', callId).order('position'),
          db.from('call_components').select('*').eq('call_id', callId).order('position'),
          db.from('call_fee_offsets').select('*').eq('call_id', callId).order('position'),
          db.from('call_transfers').select('*').eq('call_id', callId).order('position'),
          db.from('call_expected_output').select('*').eq('call_id', callId).order('position'),
          db.from('call_stages').select('stage').eq('call_id', callId).maybeSingle(),
          db
            .from('notices')
            // One string literal, not a concatenation: supabase-js infers the
            // row type from the select at the type level, and an expression
            // collapses every column to an error type.
            .select('investor_id, status, approved_at, sent_at, sent_to_email, email_status, email_error, email_delivered_to, investors!inner ( lp_id )')
            .eq('call_id', callId),
        ]);

      for (const [r, what] of [
        [register, 'the LP register'],
        [components, 'the call components'],
        [offsets, 'the fee offsets'],
        [transfers, 'the transfers'],
        [expected, 'the Expected_Output fixture'],
        [notices, 'the notice workflow'],
      ] as const) {
        if (r.error) throw asError(r.error, `load ${what}`);
      }

      const parts = {
        call,
        register: register.data ?? [],
        components: components.data ?? [],
        offsets: offsets.data ?? [],
        transfers: transfers.data ?? [],
        expectedOutput: expected.data ?? [],
      } as unknown as CallParts;

      return {
        id: call.id,
        fundId: call.fund_id,
        callNo: call.call_no,
        stage: (stage.data?.stage as CallStage) ?? 'not_started',
        lockedAt: call.locked_at,
        sources: toSources(call),
        sourceFileName: call.source_file_name,
        model: toCallModel(parts),
        notices: (notices.data ?? []).map(
          (n): NoticeState => ({
            investorId: n.investor_id as string,
            lpId: (n.investors as unknown as { lp_id: string }).lp_id,
            status: n.status as NoticeStatus,
            approvedAt: n.approved_at as string | null,
            sentAt: n.sent_at as string | null,
            sentToEmail: n.sent_to_email as string | null,
            delivery: n.email_status as NoticeState['delivery'],
            deliveryError: n.email_error as string | null,
            deliveredTo: n.email_delivered_to as string | null,
          }),
        ),
      };
    },

    async createCall(
      fundId: string,
      model: CallModel,
      sources: CallSources,
    ): Promise<CallDetail> {
      // Call numbers are unique per fund, so derive the next one rather than
      // trusting whatever a workbook happened to carry.
      const { data: existing, error: maxError } = await db
        .from('calls')
        .select('call_no')
        .eq('fund_id', fundId)
        .order('call_no', { ascending: false })
        .limit(1);
      if (maxError) throw asError(maxError, 'work out the next call number');

      const callNo = (existing?.[0]?.call_no ?? 0) + 1;
      const columns = fromCallModel(model);

      const { data: created, error: insertError } = await db
        .from('calls')
        .insert({ ...columns, fund_id: fundId, call_no: callNo })
        .select('id')
        .single();
      if (insertError) throw asError(insertError, `create Capital Call No. ${callNo}`);

      await this.saveCall(created.id, model, sources);

      const detail = await this.getCall(created.id);
      if (!detail) throw new Error('The call was created but could not be read back.');
      return detail;
    },

    async saveCall(
      callId: string,
      model: CallModel,
      sources: Partial<CallSources>,
    ): Promise<void> {
      const columns = fromCallModel(model);

      const { error } = await db.rpc('save_call_inputs', {
        p_call_id: callId,
        p_call: {
          ...columns,
          // The RPC reads this as a JSON array, not a Postgres array literal.
          fee_exempt_lp_ids: fromIdList(model.fee.Fee_Exempt_LP_IDs),
        },
        p_sources: sources,
        p_lps: model.lps
          .filter((l) => String(l.LP_ID ?? '').trim() !== '')
          .map((l, i) => ({
            ...fromLPRowIdentity(l, ''),
            ...fromLPRow(l, callId, '', i),
            // These two are resolved inside the function from lp_id.
            call_id: undefined,
            investor_id: undefined,
            fund_id: undefined,
          })),
        p_components: model.components
          .filter((c) => String(c.Component_ID ?? '').trim() !== '')
          .map((c, i) => ({ ...fromComponentRow(c, callId, i), call_id: undefined })),
        p_offsets: (model.fee.offsets ?? [])
          .filter((o) => String(o.Offset_ID ?? '').trim() !== '')
          .map((o, i) => ({ ...fromOffsetRow(o, callId, i), call_id: undefined })),
        p_transfers: model.transfers
          .filter((t) => String(t.Transfer_ID ?? '').trim() !== '')
          .map((t, i) => ({ ...fromTransferRow(t, callId, i), call_id: undefined })),
        p_expected: (model.golden ?? []).map((g, i) => {
          const { LP_ID, ...figures } = g;
          return { lp_id: LP_ID, figures, position: i };
        }),
      });

      if (error) throw asError(error, 'save the call inputs');
    },

    async deleteCall(callId: string): Promise<void> {
      const { error } = await db.from('calls').delete().eq('id', callId);
      if (error) throw asError(error, 'delete the call');
    },
  };
}

/** Numbers that arrive as strings from a view. Re-exported for the mapper's use. */
export { num };

/**
 * Turn a PostgREST error into something an accountant can act on.
 *
 * The two that matter are the database's own refusals: `restrict_violation`
 * when a call has been issued, and `insufficient_privilege` when a write is
 * reserved for the server. Both are deliberate, so they get a plain
 * explanation rather than a raw SQL message.
 */
export function asError(error: { code?: string; message: string }, doing: string): Error {
  if (error.code === '23001') {
    return new Error(
      `This capital call has been issued, so its inputs can no longer be changed. Raise a new call to correct it.`,
    );
  }
  if (error.code === '42501') {
    return new Error(
      `You do not have permission to ${doing}. Approving and sending notices is done by the server, not the browser.`,
    );
  }
  return new Error(`Could not ${doing}: ${error.message}`);
}

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

import { num } from '@/engine';
import type { CallModel } from '@/engine/types';
import {
  fromCallModel,
  fromComponentRow,
  fromIdList,
  fromLPRow,
  fromLPRowIdentity,
  fromOffsetRow,
  fromTransferRow,
  toCallModel,
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
  Client,
  ClientPosition,
  NoticeState,
  NoticeStatus,
} from './types';

/** Columns of `call_register` plus the joined investor, as PostgREST names them. */
const REGISTER_SELECT = `
  id, call_id, investor_id, commitment, opening_paid_in, opening_ucc,
  opening_invested_capital, mgmt_fee_rate_override, fee_exempt, status, position,
  investors!inner ( id, lp_id, lp_name, lp_type, contact_email, side_letter_ref, notes )
`;

export function createSupabaseRepository(db: SupabaseClient): CallRepository {
  return {
    async listClients(): Promise<Client[]> {
      const { data, error } = await db
        .from('clients')
        .select('id, name')
        .is('archived_at', null)
        .order('name');
      if (error) throw asError(error, 'load the client list');
      return data ?? [];
    },

    async createClient(name: string): Promise<Client> {
      // A firm must exist to own the fund. Where a user belongs to several,
      // this takes the first — a firm picker is a later concern.
      const { data: firms, error: firmError } = await db.from('firms').select('id').limit(1);
      if (firmError) throw asError(firmError, 'find your firm');
      if (!firms?.length) {
        throw new Error('You are not a member of any firm yet, so there is nowhere to put this fund.');
      }

      const { data, error } = await db
        .from('clients')
        .insert({ firm_id: firms[0].id, name })
        .select('id, name')
        .single();
      if (error) throw asError(error, `create the fund "${name}"`);
      return data;
    },

    async getClientPosition(clientId: string): Promise<ClientPosition | null> {
      const { data, error } = await db
        .from('client_positions')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw asError(error, 'load the fund position');
      if (!data) return null;
      return {
        clientId: data.client_id as string,
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

    async listCalls(clientId: string): Promise<CallSummary[]> {
      const { data: calls, error } = await db
        .from('calls')
        .select('id, call_no, call_date, payment_due_date, locked_at')
        .eq('client_id', clientId)
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
            .select('investor_id, status, approved_at, sent_at, sent_to_email, investors!inner ( lp_id )')
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
        clientId: call.client_id,
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
          }),
        ),
      };
    },

    async createCall(
      clientId: string,
      model: CallModel,
      sources: CallSources,
    ): Promise<CallDetail> {
      // Call numbers are unique per fund, so derive the next one rather than
      // trusting whatever a workbook happened to carry.
      const { data: existing, error: maxError } = await db
        .from('calls')
        .select('call_no')
        .eq('client_id', clientId)
        .order('call_no', { ascending: false })
        .limit(1);
      if (maxError) throw asError(maxError, 'work out the next call number');

      const callNo = (existing?.[0]?.call_no ?? 0) + 1;
      const columns = fromCallModel(model);

      const { data: created, error: insertError } = await db
        .from('calls')
        .insert({ ...columns, client_id: clientId, call_no: callNo })
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
            client_id: undefined,
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
function asError(error: { code?: string; message: string }, doing: string): Error {
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

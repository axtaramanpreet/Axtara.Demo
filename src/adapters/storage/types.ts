/**
 * The storage boundary.
 *
 * Everything above this interface — the engine, the views — knows nothing about
 * Postgres, Supabase or HTTP. Swapping the backing store means writing one new
 * implementation of `CallRepository`, not touching the app.
 */

import type { CallModel } from '@/engine/types';

/** Where a step's inputs came from, shown in the setup stepper. */
export type InputSource = 'excel' | 'manual' | 'template' | 'carried' | 'empty';

/** Per-step provenance for one call. */
export interface CallSources {
  setup: InputSource;
  lps: InputSource;
  components: InputSource;
  fee: InputSource;
  transfers: InputSource;
}

/** Derived from notices; never stored. See the `call_stages` view. */
export type CallStage = 'not_started' | 'in_progress' | 'partially_sent' | 'issued';

export type NoticeStatus = 'draft' | 'approved' | 'sent';

/** A fund the firm administers. */
export interface Client {
  id: string;
  name: string;
}

/** One investor's notice workflow state for one call. */
export interface NoticeState {
  investorId: string;
  lpId: string;
  status: NoticeStatus;
  approvedAt: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
}

/** A call as the Home list needs it — no inputs, just headline facts. */
export interface CallSummary {
  id: string;
  callNo: number;
  callDate: string | null;
  paymentDueDate: string | null;
  stage: CallStage;
  activeInvestors: number;
  noticesSent: number;
  noticesApproved: number;
  noticesDraft: number;
  lockedAt: string | null;
  /** Total called, from the frozen snapshot. Null until the call is issued. */
  totalCalled: number | null;
}

/** A call with everything needed to compute it. */
export interface CallDetail {
  id: string;
  clientId: string;
  callNo: number;
  stage: CallStage;
  lockedAt: string | null;
  sources: CallSources;
  sourceFileName: string | null;
  /** The inputs, in the shape the engine consumes. */
  model: CallModel;
  notices: NoticeState[];
}

/** Fund position for the Home card, aggregated over issued calls only. */
export interface ClientPosition {
  clientId: string;
  name: string;
  totalCommitments: number;
  /** Contributions received before the call currently open. */
  paidInCapital: number;
  investors: number;
  callsIssued: number;
  calledToDate: number;
  calledAgainstCommitment: number;
  unfundedCommitment: number;
  latestCallNo: number | null;
  nextPaymentDue: string | null;
}

/**
 * Read and write capital call data.
 *
 * Deliberately absent: anything that approves or sends a notice, or freezes a
 * snapshot. Those are privileged operations that run server-side against the
 * service role, and live in their own interface so they cannot be called by
 * accident from a component.
 */
export interface CallRepository {
  listClients(): Promise<Client[]>;
  createClient(name: string): Promise<Client>;
  /**
   * Remove a fund. The database refuses this once the fund has any call
   * history, so it only ever undoes a mistake.
   */
  deleteClient(clientId: string): Promise<void>;

  getClientPosition(clientId: string): Promise<ClientPosition | null>;
  listCalls(clientId: string): Promise<CallSummary[]>;

  getCall(callId: string): Promise<CallDetail | null>;

  /** Create the next call for a fund, seeded with `model`. */
  createCall(clientId: string, model: CallModel, sources: CallSources): Promise<CallDetail>;

  /** Replace a call's inputs. Rejected by the database once the call is issued. */
  saveCall(callId: string, model: CallModel, sources: Partial<CallSources>): Promise<void>;

  /** Delete a call. Rejected by the database once the call is issued. */
  deleteCall(callId: string): Promise<void>;
}

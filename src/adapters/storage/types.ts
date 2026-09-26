/**
 * The storage boundary.
 *
 * Everything above this interface — the engine, the views — knows nothing about
 * Postgres, Supabase or HTTP. Swapping the backing store means writing one new
 * implementation of `CallRepository`, not touching the app.
 */

import type { FundProgress } from '@/lib/fund-gates';
import type { CallModel } from '@/engine/types';
import type { FundTerms } from '@/engine/fund-terms';
import type { ClosingRecord } from '@/engine/fund-history';
import type { IssuedCall } from '@/engine/positions';

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

/** A closing as the screens need it: the engine's record, plus what the database knows. */
export interface Closing extends ClosingRecord {
  note: string | null;
  finalisedAt: string | null;
  /** investor id, for linking a commitment to its investor row. */
  commitments: (ClosingRecord['commitments'][number] & { investorId: string; contactEmail: string | null })[];
}

/** One commitment as the draft-closing form saves it. */
export interface ClosingCommitmentInput {
  lpId: string;
  name: string;
  amount: number;
  contactEmail?: string | null;
  feeRateOverride?: number | null;
  feeExempt?: boolean;
}

/** An equalization statement for one investor at one closing, as far as it has got. */
export interface ClosingStatement {
  closingId: string;
  lpId: string;
  status: 'draft' | 'approved' | 'sent';
  approvedAt: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
  emailStatus: 'pending' | 'delivered' | 'failed' | null;
  emailError: string | null;
  emailDeliveredTo: string | null;
}

/** An investor in a fund, as picked from a list. */
export type KycStatus = 'not_started' | 'in_progress' | 'approved' | 'expired';

/** An investor in a fund: the profile the Investors page keeps. */
export interface FundInvestor {
  id: string;
  lpId: string;
  name: string;
  /** Pension, endowment, family office… Legacy registers wrote 'LP' or 'GP'. */
  type: string;
  /** Where notices go. */
  email: string | null;
  /** Copied on every notice. */
  ccEmails: string[];
  country: string | null;
  isGp: boolean;
  kycStatus: KycStatus;
  sideLetterRef: string | null;
  notes: string | null;
}

/** What the Investors page can change about an investor. The LP_ID is fixed once issued. */
export type InvestorPatch = Partial<Omit<FundInvestor, 'id' | 'lpId'>>;

/** A fund, which belongs to one client. */
export interface Fund {
  id: string;
  name: string;
}

/** One investor's notice workflow state for one call. */
/** Whether the email arrived. Separate from `status`, which is about issuing. */
export type NoticeDelivery = 'delivered' | 'failed' | 'pending';

export interface NoticeState {
  investorId: string;
  lpId: string;
  status: NoticeStatus;
  approvedAt: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
  /** Null when no delivery has been attempted. */
  delivery: NoticeDelivery | null;
  /** Why it failed, verbatim from the provider. */
  deliveryError: string | null;
  /** The address actually used, which differs when a send override is on. */
  deliveredTo: string | null;
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
  fundId: string;
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
export interface FundPosition {
  fundId: string;
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
  listFunds(): Promise<Fund[]>;
  createFund(name: string): Promise<Fund>;
  /**
   * Remove a fund. The database refuses this once the fund has any call
   * history, so it only ever undoes a mistake.
   */
  deleteFund(fundId: string): Promise<void>;

  getFundPosition(fundId: string): Promise<FundPosition | null>;

  /** How far the fund has got: terms recorded, closings, calls. Counts only. */
  getFundProgress(fundId: string): Promise<FundProgress>;

  /** Every row of the fund's terms, oldest first. `termsOn` picks the one in force. */
  listFundTerms(fundId: string): Promise<FundTerms[]>;
  /**
   * Record the fund's terms, one row per date they apply from. Always new
   * rows: terms are never edited, so a change or a correction is added and
   * history is kept. Several rows — the terms now and the fee after the
   * investment period, say — go in as one statement, so either all are
   * recorded or none is.
   */
  addFundTerms(fundId: string, rows: Omit<FundTerms, 'createdAt'>[]): Promise<FundTerms[]>;

  /** The fund's investors, for picking one by LP_ID. */
  listInvestors(fundId: string): Promise<FundInvestor[]>;
  /** Add an investor the fund does not have yet. Refused if the LP_ID is taken. */
  createInvestor(fundId: string, lpId: string, profile: InvestorPatch): Promise<FundInvestor>;
  updateInvestor(investorId: string, patch: InvestorPatch): Promise<void>;

  /** Every closing, oldest first, with what it admitted and its frozen equalization. */
  listClosings(fundId: string): Promise<Closing[]>;
  /** Every equalization statement approved or sent for the fund's closings. */
  listClosingStatements(fundId: string): Promise<ClosingStatement[]>;
  /** Draft the fund's next closing. */
  createClosing(fundId: string, closingDate: string, note?: string | null): Promise<Closing>;
  /** Change a draft closing's date or note. Refused once it is finalised. */
  updateClosing(closingId: string, patch: { closingDate?: string; note?: string | null }): Promise<void>;
  /** Remove a draft closing. Refused once it is finalised. */
  deleteClosing(closingId: string): Promise<void>;
  /** Replace a draft closing's investors and commitments, in one go. */
  saveClosingCommitments(closingId: string, rows: ClosingCommitmentInput[]): Promise<void>;

  /** The fund's issued calls, as their snapshots froze them: the record closings and fees read. */
  listIssuedCalls(fundId: string): Promise<IssuedCall[]>;
  listCalls(fundId: string): Promise<CallSummary[]>;

  getCall(callId: string): Promise<CallDetail | null>;

  /** Create the next call for a fund, seeded with `model`. */
  createCall(fundId: string, model: CallModel, sources: CallSources): Promise<CallDetail>;

  /** Replace a call's inputs. Rejected by the database once the call is issued. */
  saveCall(callId: string, model: CallModel, sources: Partial<CallSources>): Promise<void>;

  /** Delete a call. Rejected by the database once the call is issued. */
  deleteCall(callId: string): Promise<void>;
}

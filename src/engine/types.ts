/**
 * Domain model for the capital call engine.
 *
 * Field names match the accountant's Excel template tab-for-tab (Fund_Setup,
 * LP_Register, Call_Components, Management_Fee, Transfers). That is deliberate:
 * it keeps the workbook, the engine and the notices speaking one vocabulary, so
 * a reviewer can put a spreadsheet column next to a line of code and see that
 * they are the same thing.
 */

/**
 * A raw value as it arrives from a spreadsheet cell or a hand-typed form field.
 * Excel hands us `1500000` or `"1,500,000"` for the same number, so everything
 * numeric is normalised through `num()` rather than trusted on arrival.
 */
export type Cell = string | number | null | undefined;

/** Excel-style boolean. `"Y"` (any case, trimmed) is true; everything else is false. */
export type YesNo = 'Y' | 'N' | string;

/** What a component or the management fee is allocated in proportion to. */
export type AllocationBasis = 'Commitment' | 'UCC' | 'Invested_Capital';

/** The fee may only be charged on these. `NAV` is accepted but falls back to Commitment. */
export type FeeBasis = 'Commitment' | 'Invested_Capital' | 'NAV' | string;

// ---------------------------------------------------------------------------
// Input model — one capital call's worth of accountant input
// ---------------------------------------------------------------------------

/** Fund_Setup tab: fund-level constants and the rounding policy. */
export interface FundSetup {
  Fund_Name: string;
  /**
   * The general partner's legal name, as it appears on the notice: "on behalf
   * of X, the General Partner of the Fund". Blank falls back to "the General
   * Partner", which reads correctly but names nobody.
   */
  GP_Name?: string;
  /** Who signs the notice. Blank simply drops the line from the sign-off. */
  Signatory_Name?: string;
  /** Their title, under the name. Blank drops the line. */
  Signatory_Title?: string;
  Reporting_Currency: string;
  Call_Number: Cell;
  /** ISO date or an Excel serial number. */
  Call_Date: Cell;
  /** ISO date or an Excel serial number. */
  Payment_Due_Date: Cell;
  Default_Mgmt_Fee_Rate_Annual: Cell;
  Default_Mgmt_Fee_Basis: FeeBasis;
  Mgmt_Fee_Period_Fraction: Cell;
  Org_Expense_Cap: Cell;
  /** Decimal places every allocation is rounded to. Usually 2 (cents). */
  Rounding_Decimals: Cell;
  /** The LP that absorbs the rounding residual so allocations tie exactly. */
  Rounding_Plug_LP_ID: string;
  Prepared_By: string;
  /**
   * 'N' when this call leaves the management fee out — a second call in a
   * period whose fee an earlier call charged. Blank or 'Y' charges it.
   */
  Charge_Mgmt_Fee?: YesNo;
  [key: string]: Cell;
}

/** LP_Register tab: one investor's identity and opening position for this call. */
export interface LPRow {
  LP_ID: string;
  LP_Name: string;
  LP_Type: string;
  Commitment: Cell;
  Opening_Paid_In: Cell;
  Opening_UCC: Cell;
  Opening_Invested_Capital: Cell;
  /** Blank unless a side letter sets a different fee rate for this LP. */
  Mgmt_Fee_Rate_Override: Cell;
  Fee_Exempt: YesNo;
  /** `Active` LPs participate. Anything else (e.g. `Transferred`) does not. */
  Status: string;
  Side_Letter_Ref?: string;
  Contact_Email?: string;
  Notes?: string;
  /**
   * Extra columns a client's own register may carry. `unknown` rather than `Cell`
   * so that `ComputedRow` can extend this row with richer computed fields; the
   * named fields above stay strictly typed, which is where the engine reads.
   */
  [key: string]: unknown;
}

/** Call_Components tab: one line of the call (a deal, an expense) before the fee. */
export interface ComponentRow {
  Component_ID: string;
  Component_Name: string;
  Category: string;
  Total_Amount: Cell;
  Allocation_Basis: AllocationBasis | string;
  /** `Y` if this draws down unfunded commitment; `N` if called outside it. */
  Reduces_Unfunded: YesNo;
  /** Comma/semicolon separated LP_IDs excused from this component. */
  Excused_LP_IDs?: string;
  Notes?: string;
  [key: string]: Cell;
}

/** Management_Fee tab, Offsets table: something that reduces the gross fee. */
export interface OffsetRow {
  Offset_ID: string;
  Description: string;
  Amount: Cell;
  /** `Pro-rata to gross fee` | `Commitment` | `Invested_Capital`. Matched loosely. */
  Allocation_Method: string;
  [key: string]: Cell;
}

/** Management_Fee tab: fee configuration, plus its offsets. */
export interface FeeConfig {
  Fee_Basis: FeeBasis;
  Default_Fee_Rate_Annual: Cell;
  /** Portion of the annual fee called now. 0.25 = one quarter. */
  Fee_Period_Fraction: Cell;
  Reduces_Unfunded: YesNo;
  /** Comma/semicolon separated LP_IDs charged 0%. */
  Fee_Exempt_LP_IDs?: string;
  offsets?: OffsetRow[];
}

/** Transfers tab: a secondary transfer between LPs. */
export interface TransferRow {
  Transfer_ID: string;
  /** Applied only when on or before the call date. */
  Effective_Date: Cell;
  From_LP_ID: string;
  To_LP_ID: string;
  /** Used to name the transferee when To_LP_ID is not yet in the register. */
  To_LP_Name_if_new?: string;
  Transfer_Type: 'Full' | 'Partial' | string;
  /** Fraction between 0 and 1. Ignored when Transfer_Type is `Full`. */
  Transfer_Pct: Cell;
  Transfers_Commitment: YesNo;
  Transfers_Paid_In: YesNo;
  Transfers_UCC: YesNo;
  Notes?: string;
  [key: string]: Cell;
}

/**
 * One row of the accountant's Expected_Output tab, used as a regression fixture.
 * Component columns are named after the component (`Deal_X`, `Org_Exp`, …), so
 * the shape varies per fund and the index signature carries them.
 */
export interface GoldenRow {
  LP_ID: string;
  [field: string]: Cell;
}

/** Everything needed to compute one capital call. */
export interface CallModel {
  setup: FundSetup;
  lps: LPRow[];
  components: ComponentRow[];
  fee: FeeConfig;
  transfers: TransferRow[];
  /** Optional Expected_Output fixture. When present, `compute` checks against it. */
  golden?: GoldenRow[] | null;
  /** Human-readable provenance of `golden`, shown in the Checks tab. */
  goldenSource?: string;
  /**
   * The management fee this call bills, period by period and investor by
   * investor, worked out from the fund's record when the periods were chosen.
   * `null` or absent: the fee is the fund's rate × this call's share of a year
   * (a fund with no closings). An empty list: this call bills no fee.
   */
  feeSchedule?: FeeScheduleEntry[] | null;
  /**
   * Later closings' equalization this call settles, investor by investor: a
   * late investor pays (+), an earlier one is credited (−). On top of what
   * the call draws; an entry marked `settles: 'on_call'` also moves paid-in and
   * unfunded on this call (an older one moved them on the closing date).
   * `null` or absent: it settles none.
   */
  equalizationSchedule?: EqualizationDueEntry[] | null;
}

/** One closing's equalization a call settles: each investor's amount, + pays, − credited. */
export interface EqualizationDueEntry {
  closingId: string;
  closingNo: number;
  closingDate: string;
  /** Each investor's net: the three parts added up. */
  byLp: Record<string, number>;
  /** The same, taken apart — so each part is shown with what it belongs to. */
  parts: Record<string, EqualizationParts>;
  /**
   * The date the capital interest runs to: the closing date, or this call's
   * payment due date when the terms run it to when the investor pays. Absent on
   * a schedule saved before it was recorded (interest to the closing date).
   */
  interestUntil?: string;
  /** True when the interest runs to this call's payment due date, so the call must have one. */
  interestToDueDate?: boolean;
  /**
   * 'on_call': the balances move on this call — the late investor's paid-in
   * rises and unfunded falls here, not on the closing date. Absent on a
   * schedule saved before that was the rule: they moved on the closing date.
   */
  settles?: 'on_call';
  /** Whether the catch-up fee counts against commitment, as the fund's fee did on the closing date. */
  feeReducesUnfunded?: boolean;
}

/**
 * An investor's equalization, in its parts, each + to pay or − credited: their
 * share of earlier calls, interest for paying it late, the management fee for
 * the time before they joined, and interest on that fee.
 */
export interface EqualizationParts {
  capital: number;
  /** The part of `capital` that counts against commitment (draws unfunded). Not added to the amount. Absent on schedules saved before it was recorded. */
  inside?: number;
  interest: number;
  catchUpFee: number;
  /** Interest on the catch-up fee. Absent on schedules saved before it existed: none. */
  feeInterest?: number;
}

/** One fee period a call bills: what each investor is charged for it. */
export interface FeeScheduleEntry {
  from: string;
  to: string;
  label: string;
  /** Fee per investor for the period, by LP_ID. */
  byLp: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Output model — what `compute` returns
// ---------------------------------------------------------------------------

/** Severity of a tie-out check, rendered as the OK/WARN/FAIL/INFO tag. */
export type CheckLevel = 'ok' | 'warn' | 'fail' | 'info';

export interface Check {
  level: CheckLevel;
  text: string;
}

/** One component as it lands on one LP. */
export interface ComputedComponent {
  id: string;
  name: string;
  category: string;
  basis: AllocationBasis | string;
  /** True when this component draws down unfunded commitment. */
  reduces: boolean;
  amt: number;
  /** True when this LP is excused from this component (shown as "excused"). */
  excused: boolean;
}

/**
 * One investor's full result for this call, carrying the LP's own fields too.
 *
 * An intersection rather than an `interface … extends`, because `LPRow` has a
 * `Cell` index signature for the arbitrary columns a workbook may add, and the
 * computed fields below are richer than `Cell`.
 */
export type ComputedRow = LPRow & {
  /** False for LPs that left the register via a full transfer. */
  isActive: boolean;
  comps: ComputedComponent[];
  feeRate: number;
  feeGross: number;
  feeOffset: number;
  feeNet: number;
  /** The fee for each scheduled period, in the schedule's order. Only on a call with a schedule. */
  feeByPeriod?: number[];
  /** Components + net fee: what this call draws. The amount to wire is `amountDue(row)`. */
  total: number;
  /** What this call settles of later closings' equalization (+ pays, − credited). Only on a call that settles some. */
  equalization?: number;
  /** The part of it that is paid-in: capital and catch-up fee, on a schedule that moves balances on this call. Only on a call that settles some. */
  eqPaid?: number;
  /** The part of it that draws unfunded commitment. Only on a call that settles some. */
  eqReduces?: number;
  /** The part of `total` that draws down unfunded commitment. */
  reduces: number;
  /** The part of `total` called outside commitment. `total - reduces`. */
  outside: number;
  openUCC: number;
  openPaid: number;
  closingUCC: number;
  closingPaid: number;
  /** Names of components this LP is excused from, for the notice footnote. */
  excusedFrom: string[];
};

/** Fund-level totals. `comps` is parallel to the component list, in order. */
export interface ComputedTotals {
  Commitment: number;
  openUCC: number;
  openPaid: number;
  comps: number[];
  feeGross: number;
  feeOffset: number;
  feeNet: number;
  total: number;
  reduces: number;
  /** Equalization this call moves into paid-in, and out of unfunded. Only on a call that settles some. */
  eqPaid?: number;
  eqReduces?: number;
  closingUCC: number;
  closingPaid: number;
}

/** A single figure that disagrees with the Expected_Output fixture. */
export interface GoldenDiff {
  lp: string;
  field: string;
  expected: string;
  actual: string;
}

/** One pro-rata allocation: amount per LP_ID, plus which LP took the residual. */
export interface AllocationResult {
  out: Record<string, number>;
  /** The LP that absorbed the rounding residual, or null when nothing allocated. */
  plugId: string | null;
  /** False when the basis summed to zero, meaning nothing could be allocated. */
  ok: boolean;
}

export interface AppliedTransfer {
  t: TransferRow;
  /** Which balances moved, and by how much. */
  moved: Partial<Record<string, number>>;
  pct: number;
}

export interface SkippedTransfer {
  t: TransferRow;
  /** Plain-English reason, surfaced as an INFO check. */
  why: string;
}

export interface TransferResult {
  /** The register as at the call date, including any new transferees. */
  roster: LPRow[];
  applied: AppliedTransfer[];
  skipped: SkippedTransfer[];
}

export interface FeeSummary {
  /** The basis actually used, after any fallback. */
  basis: FeeBasis;
  defRate: number;
  period: number;
  grossTotal: number;
  offsetTotal: number;
  /** True when the fee draws down unfunded commitment. */
  reduces: boolean;
  offsets: OffsetRow[];
  /**
   * The periods billed, when the fee comes from a schedule rather than rate ×
   * share of a year. Absent otherwise, so a call without one reads as before.
   */
  schedule?: { from: string; to: string; label: string; total: number }[];
  /** With a schedule: investors it bills who are not on this call's register, and so are billed nothing here. */
  notOnRegister?: string[];
}

/** The complete result of one capital call calculation. */
export interface ComputeResult {
  rows: ComputedRow[];
  totals: ComputedTotals;
  checks: Check[];
  goldenDiffs: GoldenDiff[];
  roster: LPRow[];
  transfers: TransferResult;
  fee: FeeSummary;
  /** The equalization this call settles, closing by closing. Only on a call that settles some. */
  equalization?: {
    closings: {
      closingId: string;
      closingNo: number;
      closingDate: string;
      paid: number;
      credited: number;
      /** Each part, added up across investors: net, + collected. */
      capital: number;
      interest: number;
      catchUpFee: number;
      feeInterest: number;
      /** The date the capital interest runs to. */
      interestUntil: string;
    }[];
    /** Paid less credited: what the fund collects net. */
    total: number;
  };
  /** Rounding decimals actually used. */
  d: number;
  /** Call date normalised to ISO. */
  callDate: string;
}

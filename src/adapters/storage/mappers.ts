/**
 * Translation between database rows and the engine's `CallModel`.
 *
 * The two sides disagree on purpose, and this is the only place that knows it:
 *
 *   - The database stores real booleans; the workbook and engine use `'Y'`/`'N'`.
 *   - The database stores ID lists as `text[]`; the workbook uses a
 *     comma-separated string.
 *   - The database stores money as `numeric`; the engine works in doubles and
 *     accepts spreadsheet formatting (`"10,000,000"`, `"$3,000,000"`) that has
 *     to be stripped on the way in.
 *
 * Getting any of these wrong is silent — a fee flag read as `'true'` is not
 * `'Y'`, so `yes()` returns false and the fee stops reducing unfunded
 * commitment; a commitment of `"10,000,000"` stored with a plain `Number()`
 * becomes NaN, then 0. Nothing throws. Hence the round-trip tests next door.
 */

import { num, serialToISO } from '@/engine';
import type { Json } from './database.types';
import type { EqualizationDueEntry, FeeScheduleEntry } from '@/engine/types';
import type {
  CallModel,
  ComponentRow,
  FundSetup,
  GoldenRow,
  LPRow,
  OffsetRow,
  TransferRow,
} from '@/engine/types';
import type { Database } from './database.types';
import type { CallSources, InputSource } from './types';
import type { FundTerms } from '@/engine/fund-terms';

type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type CallRow = Row<'calls'>;
export type RegisterRow = Row<'call_register'>;
export type ComponentDbRow = Row<'call_components'>;
export type OffsetDbRow = Row<'call_fee_offsets'>;
export type TransferDbRow = Row<'call_transfers'>;
export type ExpectedOutputRow = Row<'call_expected_output'>;
export type FundTermsRow = Row<'fund_terms'>;
export type InvestorRow = Row<'investors'>;

/** A register row with its investor joined on. */
export interface RegisterWithInvestor extends RegisterRow {
  investors: Pick<
    InvestorRow,
    'id' | 'lp_id' | 'lp_name' | 'lp_type' | 'contact_email' | 'side_letter_ref' | 'notes'
  >;
}

// ---------------------------------------------------------------------------
// Primitive conversions
// ---------------------------------------------------------------------------

/**
 * A stored amount, ready for the engine. Null becomes zero.
 *
 * PostgREST serialises `numeric` as a JSON number, so this is usually a plain
 * passthrough; it accepts a string too because the same shape is used for
 * values typed into a form. For values heading the *other* way, which may
 * carry spreadsheet formatting, use `toStoredAmount`.
 */
export function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * An engine-side amount, ready to store.
 *
 * Uses the engine's own `num`, which strips the thousands separators, currency
 * symbols and stray spaces that arrive from a workbook or a typed-in cell.
 * Plain `Number("10,000,000")` is NaN, and storing that as 0 would wipe an
 * investor's commitment without anything failing.
 */
export function toStoredAmount(v: unknown): number {
  return num(v as string | number | null | undefined);
}

/** Same, but preserves "not set" rather than collapsing it to zero. */
export function toOptionalNumber(v: string | number | null | undefined): number | '' {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : '';
}

/** Database boolean to the workbook's `'Y'`/`'N'`. */
export function toYesNo(v: boolean | null | undefined): 'Y' | 'N' {
  return v ? 'Y' : 'N';
}

/** Workbook `'Y'` to a database boolean. */
export function fromYesNo(v: unknown): boolean {
  return String(v ?? '').trim().toUpperCase() === 'Y';
}

/** `text[]` to the workbook's comma-separated list. */
export function toIdList(v: string[] | null | undefined): string {
  return (v ?? []).join(', ');
}

/** Comma- or semicolon-separated list to `text[]`. */
export function fromIdList(v: unknown): string[] {
  return String(v ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Database -> engine
// ---------------------------------------------------------------------------

export function toFundSetup(call: CallRow): FundSetup {
  return {
    Fund_Name: call.fund_name,
    GP_Name: call.gp_name ?? '',
    Signatory_Name: call.signatory_name ?? '',
    Signatory_Title: call.signatory_title ?? '',
    Reporting_Currency: call.reporting_currency ?? '',
    Call_Number: call.call_no,
    Call_Date: call.call_date ?? '',
    Payment_Due_Date: call.payment_due_date ?? '',
    Default_Mgmt_Fee_Rate_Annual: toOptionalNumber(call.default_mgmt_fee_rate_annual),
    Default_Mgmt_Fee_Basis: call.default_mgmt_fee_basis ?? '',
    Mgmt_Fee_Period_Fraction: toOptionalNumber(call.mgmt_fee_period_fraction),
    Org_Expense_Cap: toOptionalNumber(call.org_expense_cap),
    Rounding_Decimals: call.rounding_decimals ?? '',
    Rounding_Plug_LP_ID: call.rounding_plug_lp_id ?? '',
    Prepared_By: '',
    Charge_Mgmt_Fee: call.charge_mgmt_fee === false ? 'N' : 'Y',
  };
}

export function toLPRow(r: RegisterWithInvestor): LPRow {
  return {
    LP_ID: r.investors.lp_id,
    LP_Name: r.investors.lp_name,
    LP_Type: r.investors.lp_type,
    Commitment: toNumber(r.commitment),
    Opening_Paid_In: toNumber(r.opening_paid_in),
    Opening_UCC: toNumber(r.opening_ucc),
    Opening_Invested_Capital: toNumber(r.opening_invested_capital),
    Mgmt_Fee_Rate_Override: toOptionalNumber(r.mgmt_fee_rate_override),
    Fee_Exempt: toYesNo(r.fee_exempt),
    Status: r.status,
    Side_Letter_Ref: r.investors.side_letter_ref ?? '',
    Contact_Email: r.investors.contact_email ?? '',
    Notes: r.investors.notes ?? '',
  };
}

export function toComponentRow(c: ComponentDbRow): ComponentRow {
  return {
    Component_ID: c.component_id,
    Component_Name: c.component_name,
    Category: c.category ?? '',
    Total_Amount: toNumber(c.total_amount),
    Allocation_Basis: c.allocation_basis,
    Reduces_Unfunded: toYesNo(c.reduces_unfunded),
    Excused_LP_IDs: toIdList(c.excused_lp_ids),
    Notes: c.notes ?? '',
  };
}

export function toOffsetRow(o: OffsetDbRow): OffsetRow {
  return {
    Offset_ID: o.offset_id,
    Description: o.description ?? '',
    Amount: toNumber(o.amount),
    Allocation_Method: o.allocation_method,
  };
}

export function toTransferRow(t: TransferDbRow): TransferRow {
  return {
    Transfer_ID: t.transfer_id,
    Effective_Date: t.effective_date ?? '',
    From_LP_ID: t.from_lp_id ?? '',
    To_LP_ID: t.to_lp_id ?? '',
    To_LP_Name_if_new: t.to_lp_name_if_new ?? '',
    Transfer_Type: t.transfer_type,
    Transfer_Pct: toOptionalNumber(t.transfer_pct),
    Transfers_Commitment: toYesNo(t.transfers_commitment),
    Transfers_Paid_In: toYesNo(t.transfers_paid_in),
    Transfers_UCC: toYesNo(t.transfers_ucc),
    Notes: t.notes ?? '',
  };
}

export function toGoldenRow(e: ExpectedOutputRow): GoldenRow {
  // `figures` is JSONB keyed by the workbook's own column names.
  return { LP_ID: e.lp_id, ...(e.figures as Record<string, never>) };
}

export interface CallParts {
  call: CallRow;
  register: RegisterWithInvestor[];
  components: ComponentDbRow[];
  offsets: OffsetDbRow[];
  transfers: TransferDbRow[];
  expectedOutput: ExpectedOutputRow[];
}

/** Assemble the engine's input model from its constituent rows. */
export function toCallModel(parts: CallParts): CallModel {
  const golden = parts.expectedOutput.map(toGoldenRow);
  return {
    setup: toFundSetup(parts.call),
    lps: parts.register.map(toLPRow),
    components: parts.components.map(toComponentRow),
    fee: {
      Fee_Basis: parts.call.fee_basis ?? '',
      Default_Fee_Rate_Annual: toOptionalNumber(parts.call.fee_default_rate_annual),
      Fee_Period_Fraction: toOptionalNumber(parts.call.fee_period_fraction),
      Reduces_Unfunded: toYesNo(parts.call.fee_reduces_unfunded),
      Fee_Exempt_LP_IDs: toIdList(parts.call.fee_exempt_lp_ids),
      offsets: parts.offsets.map(toOffsetRow),
    },
    transfers: parts.transfers.map(toTransferRow),
    golden: golden.length ? golden : null,
    goldenSource: golden.length ? 'uploaded workbook · Expected_Output' : '',
    // Only when the call has one: a call without charges rate × share of a year.
    ...(Array.isArray(parts.call.fee_schedule) && { feeSchedule: parts.call.fee_schedule as unknown as FeeScheduleEntry[] }),
    ...(Array.isArray(parts.call.equalization_schedule) && {
      equalizationSchedule: parts.call.equalization_schedule as unknown as EqualizationDueEntry[],
    }),
  };
}

export function toSources(call: CallRow): CallSources {
  return {
    setup: call.source_setup as InputSource,
    lps: call.source_lps as InputSource,
    components: call.source_components as InputSource,
    fee: call.source_fee as InputSource,
    transfers: call.source_transfers as InputSource,
  };
}

// ---------------------------------------------------------------------------
// Engine -> database
// ---------------------------------------------------------------------------

/** The Fund_Setup and Management_Fee columns of a `calls` row. */
export function fromCallModel(model: CallModel) {
  const s = model.setup;
  return {
    fund_name: String(s.Fund_Name ?? ''),
    gp_name: emptyToNull(s.GP_Name),
    signatory_name: emptyToNull(s.Signatory_Name),
    signatory_title: emptyToNull(s.Signatory_Title),
    reporting_currency: currencyOrNull(s.Reporting_Currency),
    call_date: toStoredDate(s.Call_Date),
    payment_due_date: toStoredDate(s.Payment_Due_Date),
    default_mgmt_fee_rate_annual: numericOrNull(s.Default_Mgmt_Fee_Rate_Annual),
    default_mgmt_fee_basis: emptyToNull(s.Default_Mgmt_Fee_Basis),
    mgmt_fee_period_fraction: numericOrNull(s.Mgmt_Fee_Period_Fraction),
    org_expense_cap: numericOrNull(s.Org_Expense_Cap),
    rounding_decimals: decimalsOrNull(s.Rounding_Decimals),
    rounding_plug_lp_id: emptyToNull(s.Rounding_Plug_LP_ID),
    // Blank charges the fee, as every call did before a call could leave it out.
    charge_mgmt_fee: String(s.Charge_Mgmt_Fee ?? '').trim().toUpperCase() !== 'N',
    fee_schedule: (model.feeSchedule ?? null) as unknown as Json,
    equalization_schedule: (model.equalizationSchedule ?? null) as unknown as Json,

    fee_basis: emptyToNull(model.fee.Fee_Basis),
    fee_default_rate_annual: numericOrNull(model.fee.Default_Fee_Rate_Annual),
    fee_period_fraction: numericOrNull(model.fee.Fee_Period_Fraction),
    fee_reduces_unfunded: fromYesNo(model.fee.Reduces_Unfunded),
    fee_exempt_lp_ids: fromIdList(model.fee.Fee_Exempt_LP_IDs),
  };
}

export function fromComponentRow(c: ComponentRow, callId: string, position: number) {
  return {
    call_id: callId,
    component_id: c.Component_ID,
    component_name: c.Component_Name,
    category: emptyToNull(c.Category),
    total_amount: toStoredAmount(c.Total_Amount),
    // Stored as entered. An unrecognised basis is reported by the engine as a
    // warning, not quietly rewritten here.
    allocation_basis: String(c.Allocation_Basis ?? ''),
    reduces_unfunded: fromYesNo(c.Reduces_Unfunded),
    excused_lp_ids: fromIdList(c.Excused_LP_IDs),
    notes: emptyToNull(c.Notes),
    position,
  };
}

export function fromOffsetRow(o: OffsetRow, callId: string, position: number) {
  return {
    call_id: callId,
    offset_id: o.Offset_ID,
    description: emptyToNull(o.Description),
    amount: toStoredAmount(o.Amount),
    allocation_method: String(o.Allocation_Method || 'Pro-rata to gross fee'),
    position,
  };
}

export function fromTransferRow(t: TransferRow, callId: string, position: number) {
  return {
    call_id: callId,
    transfer_id: t.Transfer_ID,
    effective_date: toStoredDate(t.Effective_Date),
    from_lp_id: emptyToNull(t.From_LP_ID),
    to_lp_id: emptyToNull(t.To_LP_ID),
    to_lp_name_if_new: emptyToNull(t.To_LP_Name_if_new),
    transfer_type: String(t.Transfer_Type ?? ''),
    transfer_pct: numericOrNull(t.Transfer_Pct),
    transfers_commitment: fromYesNo(t.Transfers_Commitment),
    transfers_paid_in: fromYesNo(t.Transfers_Paid_In),
    transfers_ucc: fromYesNo(t.Transfers_UCC),
    notes: emptyToNull(t.Notes),
    position,
  };
}

/** The per-call balance columns of a `call_register` row. */
export function fromLPRow(l: LPRow, callId: string, investorId: string, position: number) {
  return {
    call_id: callId,
    investor_id: investorId,
    commitment: toStoredAmount(l.Commitment),
    opening_paid_in: toStoredAmount(l.Opening_Paid_In),
    opening_ucc: toStoredAmount(l.Opening_UCC),
    opening_invested_capital: toStoredAmount(l.Opening_Invested_Capital),
    mgmt_fee_rate_override: numericOrNull(l.Mgmt_Fee_Rate_Override),
    fee_exempt: fromYesNo(l.Fee_Exempt),
    // Any status other than Active means "not participating" to the engine, so
    // a client's own vocabulary survives storage.
    status: String(l.Status ?? 'Active'),
    position,
  };
}

/**
 * The identity columns of an `investors` row, as a call's register holds them.
 *
 * Blanks go as blanks. `save_call_inputs` fills the defaults for an investor
 * the fund does not know yet, and for one it does, a blank leaves the profile
 * as the Investors page set it. Defaulting here would turn every blank into a
 * value — a type of 'LP' — and overwrite the profile with it.
 */
export function fromLPRowIdentity(l: LPRow, fundId: string) {
  return {
    fund_id: fundId,
    lp_id: l.LP_ID,
    lp_name: String(l.LP_Name ?? ''),
    lp_type: String(l.LP_Type ?? ''),
    contact_email: emptyToNull(l.Contact_Email) as string | null,
    side_letter_ref: emptyToNull(l.Side_Letter_Ref),
    notes: emptyToNull(l.Notes),
  };
}

/** Blank strings mean "not set" in a spreadsheet; the database wants null. */
function emptyToNull(v: unknown): string | null {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
}

/**
 * A date ready for a `date` column.
 *
 * Workbook cells arrive as Excel serial day counts (46296) as readily as ISO
 * strings; Postgres accepts only the latter. `serialToISO` handles both.
 */
function toStoredDate(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return serialToISO(v as string | number) || null;
}

/** A blank numeric field is null, not zero — a missing fee rate is not 0%. */
/**
 * An ISO currency code, or NULL when it has not been chosen.
 *
 * Upper-cased and trimmed because the column checks `^[A-Z]{3}$`, and an
 * accountant typing `usd` should not be met with a constraint violation.
 */
function currencyOrNull(v: unknown): string | null {
  const s = emptyToNull(v);
  return s === null ? null : s.toUpperCase();
}

/**
 * Rounding decimals, or NULL when they have not been chosen.
 *
 * Not `Number(v ?? 2)`: an unset field arrives as `''`, which is neither null
 * nor undefined, so `??` never fired and `Number('')` stored 0 — silently
 * turning "not decided" into "round to whole units" on a fund calling in
 * cents. Blank means blank; the engine reads that as 2.
 */
function decimalsOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return Math.max(0, Math.round(Number(v)));
}

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return toStoredAmount(v);
}


// ---------------------------------------------------------------------------
// Fund terms
// ---------------------------------------------------------------------------

/** Numeric columns arrive from PostgREST as numbers or strings. Null stays null. */
const orNull = (v: string | number | null): number | null => (v === null ? null : toNumber(v));

export function toFundTerms(r: FundTermsRow): FundTerms {
  return {
    effectiveFrom: r.effective_from,
    createdAt: r.created_at,
    reportingCurrency: r.reporting_currency,
    roundingDecimals: r.rounding_decimals,
    roundingPlugLpId: r.rounding_plug_lp_id,
    feeBasis: r.fee_basis,
    feeRateAnnual: orNull(r.fee_rate_annual),
    feePeriodFraction: orNull(r.fee_period_fraction),
    feeReducesUnfunded: r.fee_reduces_unfunded,
    feeExemptLpIds: r.fee_exempt_lp_ids ?? [],
    orgExpenseCap: orNull(r.org_expense_cap),
    gpName: r.gp_name,
    signatoryName: r.signatory_name,
    signatoryTitle: r.signatory_title,
    investmentPeriodEnd: r.investment_period_end,
    fundTermEnd: r.fund_term_end,
    feeTiming: r.fee_timing as FundTerms['feeTiming'],
    feeDayCount: r.fee_day_count as FundTerms['feeDayCount'],
    lateCloseInterestRate: orNull(r.late_close_interest_rate),
    catchUpFeeInterestRate: orNull(r.catch_up_fee_interest_rate),
    lateCloseInterestBasis: r.late_close_interest_basis as FundTerms['lateCloseInterestBasis'],
    catchUpFeeTo: r.catch_up_fee_to as FundTerms['catchUpFeeTo'],
    equalizationInterestTo: r.equalization_interest_to as FundTerms['equalizationInterestTo'],
    equalizationInterestUntil: r.equalization_interest_until as FundTerms['equalizationInterestUntil'],
    catchUpFeeInterest: r.catch_up_fee_interest as FundTerms['catchUpFeeInterest'],
    catchUpFeeUntil: r.catch_up_fee_until as FundTerms['catchUpFeeUntil'],
    paymentBankName: r.payment_bank_name,
    paymentAccountName: r.payment_account_name,
    paymentAccountNo: r.payment_account_no,
    paymentSwift: r.payment_swift,
    paymentRouting: r.payment_routing,
    paymentReference: r.payment_reference,
    note: r.note,
  };
}

/**
 * A new terms row. Blanks go in as null, never as '' or 0: a blank term is
 * "not set", and the Settings screen has to be able to tell that apart.
 */
export function fromFundTerms(fundId: string, t: Omit<FundTerms, 'createdAt'>) {
  const text = (v: string | null) => emptyToNull(v);
  return {
    fund_id: fundId,
    effective_from: t.effectiveFrom,
    reporting_currency: text(t.reportingCurrency)?.toUpperCase() ?? null,
    rounding_decimals: t.roundingDecimals,
    rounding_plug_lp_id: text(t.roundingPlugLpId),
    fee_basis: text(t.feeBasis),
    fee_rate_annual: t.feeRateAnnual,
    fee_period_fraction: t.feePeriodFraction,
    fee_reduces_unfunded: t.feeReducesUnfunded,
    fee_exempt_lp_ids: t.feeExemptLpIds.map((id) => id.trim()).filter(Boolean),
    org_expense_cap: t.orgExpenseCap,
    gp_name: text(t.gpName),
    signatory_name: text(t.signatoryName),
    signatory_title: text(t.signatoryTitle),
    investment_period_end: text(t.investmentPeriodEnd),
    fund_term_end: text(t.fundTermEnd),
    fee_timing: t.feeTiming,
    fee_day_count: t.feeDayCount,
    late_close_interest_rate: t.lateCloseInterestRate,
    catch_up_fee_interest_rate: t.catchUpFeeInterestRate,
    late_close_interest_basis: t.lateCloseInterestBasis,
    catch_up_fee_to: t.catchUpFeeTo,
    equalization_interest_to: t.equalizationInterestTo,
    equalization_interest_until: t.equalizationInterestUntil,
    catch_up_fee_interest: t.catchUpFeeInterest,
    catch_up_fee_until: t.catchUpFeeUntil,
    payment_bank_name: text(t.paymentBankName),
    payment_account_name: text(t.paymentAccountName),
    payment_account_no: text(t.paymentAccountNo),
    payment_swift: text(t.paymentSwift),
    payment_routing: text(t.paymentRouting),
    payment_reference: text(t.paymentReference),
    note: text(t.note),
  };
}

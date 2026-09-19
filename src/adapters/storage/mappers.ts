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

type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type CallRow = Row<'calls'>;
export type RegisterRow = Row<'call_register'>;
export type ComponentDbRow = Row<'call_components'>;
export type OffsetDbRow = Row<'call_fee_offsets'>;
export type TransferDbRow = Row<'call_transfers'>;
export type ExpectedOutputRow = Row<'call_expected_output'>;
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
    // a firm's own vocabulary survives storage.
    status: String(l.Status ?? 'Active'),
    position,
  };
}

/** The identity columns of an `investors` row. */
export function fromLPRowIdentity(l: LPRow, clientId: string) {
  return {
    client_id: clientId,
    lp_id: l.LP_ID,
    lp_name: l.LP_Name || l.LP_ID,
    lp_type: l.LP_Type || 'LP',
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

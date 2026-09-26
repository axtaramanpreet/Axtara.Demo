import { CATEGORIES } from '@/engine/categories';

/**
 * The shape of the accountant's input template.
 *
 * One place that describes every tab's columns and fields. The workbook parser
 * uses it to know which keys to read, and the Set up call screens use it to
 * render the editable tables — so a column added here appears in both, and the
 * spreadsheet and the UI cannot drift apart.
 */

/** A column in one of the wide editable tables. */
export interface ColumnDef {
  key: string;
  /** Rendered width in px. */
  w: number;
  /** Right-align and parse as a number. */
  num?: boolean;
  /** id of a `<datalist>` supplying suggestions for this column. */
  list?: string;
  /** Picked from these and nothing else: what the value decides is not left to spelling. */
  options?: readonly string[];
}

/** A field in one of the Field / Value / Notes tables. */
export interface FieldDef {
  key: string;
  /** What the screen calls it. The key stays the workbook's column name. */
  label: string;
  /** Set for the call, not typed: the call's number, the fund's name. */
  auto?: string;
  /** Shown in the Notes column, explaining the field to the accountant. */
  note: string;
  num?: boolean;
  list?: string;
  type?: 'date';
  /**
   * Picked from a list rather than typed: a currency code, or one of this
   * call's investors. Anything else would be a value nothing can act on.
   */
  pick?: 'currency' | 'investor';
}

export const LP_COLUMNS: ColumnDef[] = [
  { key: 'LP_ID', w: 64 },
  { key: 'LP_Name', w: 200 },
  { key: 'LP_Type', w: 70, list: 'dl-lptype' },
  { key: 'Commitment', w: 120, num: true },
  { key: 'Opening_Paid_In', w: 120, num: true },
  { key: 'Opening_UCC', w: 120, num: true },
  { key: 'Opening_Invested_Capital', w: 120, num: true },
  { key: 'Mgmt_Fee_Rate_Override', w: 90, num: true },
  { key: 'Fee_Exempt', w: 60, list: 'dl-yn' },
  { key: 'Status', w: 100, list: 'dl-status' },
  { key: 'Side_Letter_Ref', w: 110 },
  { key: 'Contact_Email', w: 200 },
  { key: 'Notes', w: 220 },
];

export const COMPONENT_COLUMNS: ColumnDef[] = [
  { key: 'Component_ID', w: 70 },
  { key: 'Component_Name', w: 200, list: 'dl-component-names' },
  { key: 'Category', w: 190, options: CATEGORIES },
  { key: 'Total_Amount', w: 130, num: true },
  { key: 'Allocation_Basis', w: 130, list: 'dl-basis' },
  { key: 'Reduces_Unfunded', w: 70, list: 'dl-yn' },
  { key: 'Excused_LP_IDs', w: 130 },
  { key: 'Notes', w: 260 },
];

export const TRANSFER_COLUMNS: ColumnDef[] = [
  { key: 'Transfer_ID', w: 70 },
  { key: 'Effective_Date', w: 120 },
  { key: 'From_LP_ID', w: 80 },
  { key: 'To_LP_ID', w: 80 },
  { key: 'To_LP_Name_if_new', w: 180 },
  { key: 'Transfer_Type', w: 90, list: 'dl-ttype' },
  { key: 'Transfer_Pct', w: 80, num: true },
  { key: 'Transfers_Commitment', w: 70, list: 'dl-yn' },
  { key: 'Transfers_Paid_In', w: 70, list: 'dl-yn' },
  { key: 'Transfers_UCC', w: 70, list: 'dl-yn' },
  { key: 'Notes', w: 260 },
];

export const OFFSET_COLUMNS: ColumnDef[] = [
  { key: 'Offset_ID', w: 70 },
  { key: 'Description', w: 300 },
  { key: 'Amount', w: 130, num: true },
  { key: 'Allocation_Method', w: 200, list: 'dl-offmethod' },
];

export const SETUP_FIELDS: FieldDef[] = [
  { key: 'Fund_Name', label: 'Fund name', auto: "The fund's own name.", note: 'Shown on every notice.' },
  { key: 'GP_Name', label: 'General partner', note: 'The general partner, named in the notice letter.' },
  { key: 'Reporting_Currency', label: 'Currency', note: 'ISO code.', pick: 'currency' },
  { key: 'Call_Number', label: 'Call number', auto: "Numbered in order within the fund.", note: 'Increment each call.', num: true },
  { key: 'Call_Date', label: 'Notice date', note: 'Effective date of the call (YYYY-MM-DD).', type: 'date' },
  { key: 'Payment_Due_Date', label: 'Payment due', note: 'When LP wires are due.', type: 'date' },
  {
    key: 'Default_Mgmt_Fee_Rate_Annual',
    label: 'Management fee rate',
    note: 'Fraction; 0.02 = 2%. Management_Fee tab wins if set.',
    num: true,
  },
  { key: 'Default_Mgmt_Fee_Basis', label: 'Fee charged on', note: 'Commitment | Invested_Capital | NAV.', list: 'dl-basis' },
  { key: 'Mgmt_Fee_Period_Fraction', label: 'Fee period', note: '0.25 = one quarter.', num: true },
  { key: 'Org_Expense_Cap', label: 'Organizational expense cap', note: 'Cap on organizational expenses.', num: true },
  { key: 'Rounding_Decimals', label: 'Rounding decimals', note: 'Decimal places for every allocation.', num: true },
  { key: 'Rounding_Plug_LP_ID', label: 'Rounding plug', note: 'Absorbs the rounding residual.', pick: 'investor' },
  { key: 'Signatory_Name', label: 'Signatory', note: 'Who signs the notice. Blank drops the line.' },
  { key: 'Signatory_Title', label: 'Signatory title', note: 'Their title, under the name.' },
  { key: 'Prepared_By', label: 'Prepared by', note: 'Traceability.' },
];

export const FEE_FIELDS: FieldDef[] = [
  { key: 'Fee_Basis', label: 'Fee charged on', note: 'Commitment | Invested_Capital | NAV.', list: 'dl-basis' },
  { key: 'Default_Fee_Rate_Annual', label: 'Fee rate', note: 'Fraction; 0.02 = 2%.', num: true },
  { key: 'Fee_Period_Fraction', label: 'Fee period', note: 'Portion of annual fee called now.', num: true },
  { key: 'Reduces_Unfunded', label: 'Counts against commitment', note: 'Y if drawn from commitment.', list: 'dl-yn' },
  { key: 'Fee_Exempt_LP_IDs', label: 'Exempt investors', note: 'Comma-separated LP_IDs charged 0%.' },
];

/** Fee keys the parser lifts off the Management_Fee tab. */
export const FEE_FIELD_KEYS = FEE_FIELDS.map((f) => f.key);

/** Suggestion lists backing the `<datalist>` on enum columns. */
export const DATALISTS: Record<string, string[]> = {
  'dl-yn': ['Y', 'N'],
  'dl-basis': ['Commitment', 'UCC', 'Invested_Capital'],
  'dl-lptype': ['LP', 'GP'],
  'dl-status': ['Active', 'Transferred', 'Defaulted'],
  'dl-ttype': ['Full', 'Partial'],
  'dl-offmethod': ['Pro-rata to gross fee', 'Commitment', 'Invested_Capital'],
};

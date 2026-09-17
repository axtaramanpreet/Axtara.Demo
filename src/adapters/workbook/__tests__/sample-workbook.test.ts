/**
 * The sample input workbook in `samples/`.
 *
 * This file is the sample's source of truth: the tab layout and every figure
 * live here, and the committed `.xlsx` is generated from them. Regenerate with
 *
 *   WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/sample-workbook.test.ts
 *
 * Without that flag the test only reads. It parses the definition through the
 * real parser, checks the call ties out, and then checks the committed file
 * parses to the same model — so the shipped sample cannot drift away from the
 * definition, and a sample that would show a FAIL on upload cannot be shipped.
 *
 * The models are compared rather than the bytes: two writes of the same
 * workbook differ in zip metadata, which says nothing about the data.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { newModelFromTemplate } from '@/engine/fixtures/illustrative-fund';
import type { CallModel } from '@/engine/types';
import { parseWorkbook, type WorkbookLike, type WorkbookReader } from '../parse-workbook';

const SAMPLE_PATH = fileURLToPath(
  new URL('../../../../samples/meridian-growth-partners-iii-call-4.xlsx', import.meta.url),
);

type Row = (string | number)[];

// ---------------------------------------------------------------------------
// The fund
//
// A mid-life buyout fund at its fourth call, past its investment period, so the
// management fee is charged on invested capital rather than commitment.
//
// Deliberately plain: no transfers, no excused investors, and opening balances
// that already tie. Anything the app flags when this is uploaded is the app,
// not the fixture. The awkward cases live in `src/engine/fixtures/scenarios.ts`.
// ---------------------------------------------------------------------------

const SETUP: Row[] = [
  ['Fund Setup', '', ''],
  ['One row per field. Enter values in the Value column.', '', ''],
  ['Field', 'Value', 'Notes / allowed values'],
  ['Fund_Name', 'Meridian Growth Partners III, L.P.', 'Free text; shown on every notice.'],
  ['Reporting_Currency', 'USD', 'ISO code.'],
  ['Call_Number', 4, 'Integer. Increment each call.'],
  ['Call_Date', '2026-11-16', 'Effective date of the call (YYYY-MM-DD).'],
  ['Payment_Due_Date', '2026-11-30', 'When LP wires are due.'],
  ['Default_Mgmt_Fee_Rate_Annual', 0.0175, 'Fraction. 0.0175 = 1.75%.'],
  ['Default_Mgmt_Fee_Basis', 'Invested_Capital', 'Commitment | Invested_Capital | NAV.'],
  ['Mgmt_Fee_Period_Fraction', 0.25, 'Portion of the annual fee called now. 0.25 = one quarter.'],
  ['Org_Expense_Cap', 750000, 'Lifetime cap on organizational expenses.'],
  ['Rounding_Decimals', 2, 'Decimal places for every allocation.'],
  ['Rounding_Plug_LP_ID', 'LP04', 'Absorbs the rounding residual. Largest commitment.'],
  ['Prepared_By', 'Fund Administration', 'Traceability.'],
];

const LP_HEADER: Row = [
  'LP_ID', 'LP_Name', 'LP_Type', 'Commitment', 'Opening_Paid_In', 'Opening_UCC',
  'Opening_Invested_Capital', 'Mgmt_Fee_Rate_Override', 'Fee_Exempt', 'Status',
  'Contact_Email', 'Side_Letter_Ref', 'Notes',
];

// Every investor is 35% drawn at the start of this call, so Opening_Paid_In and
// Opening_UCC sum to Commitment. Invested capital is 88% of paid-in; the rest
// went to fees and expenses in earlier calls.
const LP_ROWS: Row[] = [
  ['LP01', 'Northbridge Retirement System', 'LP', 25000000, 8750000, 16250000, 7700000, '', 'N', 'Active', 'treasury@northbridge-rs.example', '', ''],
  ['LP02', 'Kestrel University Endowment', 'LP', 12000000, 4200000, 7800000, 3696000, '', 'N', 'Active', 'privatemarkets@kestrel.example', '', ''],
  ['LP03', 'Tanaka Family Holdings KK', 'LP', 6000000, 2100000, 3900000, 1848000, 0.015, 'N', 'Active', 'ops@tanakaholdings.example', 'SL-2023-11', 'Mgmt fee reduced to 1.50% per side letter'],
  ['LP04', 'Arbor Mutual Assurance', 'LP', 30000000, 10500000, 19500000, 9240000, '', 'N', 'Active', 'altinvestments@arbormutual.example', '', 'Largest commitment; rounding plug'],
  ['LP05', 'Halvorsen Nominees Limited', 'LP', 9500000, 3325000, 6175000, 2926000, '', 'N', 'Active', 'fundops@halvorsen.example', '', 'Nominee for underlying feeder investors'],
  ['LP06', 'Sycamore Foundation', 'LP', 4500000, 1575000, 2925000, 1386000, '', 'N', 'Active', 'finance@sycamorefdn.example', '', ''],
  ['LP07', 'Bridgeline Capital SCSp', 'LP', 8000000, 2800000, 5200000, 2464000, '', 'N', 'Active', 'capitalcalls@bridgeline.example', '', 'Luxembourg feeder'],
  ['GP01', 'Meridian Growth GP III LLC', 'GP', 1000000, 350000, 650000, 308000, '', 'Y', 'Active', 'finance@meridiangp.example', '', 'GP commitment; exempt from the management fee'],
];

const REGISTER: Row[] = [
  ['LP Register (investor roster)', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Opening balances are AS AT the start of this call.', '', '', '', '', '', '', '', '', '', '', '', ''],
  LP_HEADER,
  ...LP_ROWS,
];

const COMPONENT_HEADER: Row = [
  'Component_ID', 'Component_Name', 'Category', 'Total_Amount',
  'Allocation_Basis', 'Reduces_Unfunded', 'Excused_LP_IDs', 'Notes',
];

// Component names carry no punctuation and share no leading words. The
// Expected_Output tab matches its columns back to these names by loose prefix,
// so "Project Helios" alongside "Project Helios II" would be ambiguous, and a
// hyphen in a name would stop its column matching at all.
const COMPONENT_ROWS: Row[] = [
  ['C1', 'Project Helios', 'Deal', 6200000, 'Commitment', 'Y', '', 'Platform acquisition; allocated on committed capital.'],
  ['C2', 'Project Orion', 'Deal', 3400000, 'Commitment', 'Y', '', 'Bolt-on acquisition; allocated on committed capital.'],
  ['C3', 'Bridge Facility Repayment', 'Deal', 1250000, 'UCC', 'Y', '', 'Repays the subscription line; allocated on UNFUNDED commitment.'],
  ['C4', 'Fund Operating Expenses', 'Partnership Expense', 285000, 'Commitment', 'Y', '', 'Audit, tax, administration and custody for the period.'],
  ['C5', 'Formation Cost True Up', 'Organizational Expense', 120000, 'Commitment', 'N', '', 'OUTSIDE commitment: contributed but does NOT reduce unfunded.'],
];

const COMPONENTS: Row[] = [
  ['Call Components (line items for THIS call)', '', '', '', '', '', '', ''],
  ['One row per deal and per expense. The management fee is configured on the Management_Fee tab.', '', '', '', '', '', '', ''],
  COMPONENT_HEADER,
  ...COMPONENT_ROWS,
];

const FEE: Row[] = [
  ['Management Fee', '', '', ''],
  ['The default rate is here; per-LP side-letter rates live in LP_Register.', '', '', ''],
  ['Field', 'Value', 'Notes', ''],
  ['Fee_Basis', 'Invested_Capital', 'Past the investment period: charged on invested capital, not commitment.', ''],
  ['Default_Fee_Rate_Annual', 0.0175, 'Fraction. 0.0175 = 1.75%.', ''],
  ['Fee_Period_Fraction', 0.25, 'Portion of the annual fee called now. 0.25 = one quarter.', ''],
  ['Reduces_Unfunded', 'Y', 'Y if the fee is drawn from commitment.', ''],
  ['Fee_Exempt_LP_IDs', 'GP01', 'Comma-separated LP_IDs charged 0%.', ''],
  ['', '', '', ''],
  ['Offsets (reduce the gross fee)', '', '', ''],
  ['Offset_ID', 'Description', 'Amount', 'Allocation_Method'],
  ['O1', 'Portfolio company monitoring fees (100% sharing)', 62500, 'Pro-rata to gross fee'],
  ['O2', 'Broken deal cost recovery', 18000, 'Pro-rata to gross fee'],
];

// Header only, and that is meaningful: the parser replaces the transfer list
// whenever this tab is present, so an empty table clears whatever transfer the
// call being uploaded into happened to carry.
const TRANSFERS: Row[] = [
  ['Transfers (OPTIONAL)', '', '', '', '', '', '', '', '', '', ''],
  ['One row per transfer, applied BEFORE the call is allocated. None this call.', '', '', '', '', '', '', '', '', '', ''],
  ['Transfer_ID', 'Effective_Date', 'From_LP_ID', 'To_LP_ID', 'To_LP_Name_if_new', 'Transfer_Type',
    'Transfer_Pct', 'Transfers_Commitment', 'Transfers_Paid_In', 'Transfers_UCC', 'Notes'],
];

const README: Row[] = [
  ['Capital Call Engine — Input Workbook'],
  [''],
  ['Meridian Growth Partners III, L.P. — Call 4, dated 2026-11-16.'],
  [''],
  ['Tabs the engine reads:'],
  ['  Fund_Setup        Fund-level constants and the rounding policy.'],
  ['  LP_Register       One row per investor, with opening balances as at this call.'],
  ['  Call_Components   One row per deal and per expense in this call.'],
  ['  Management_Fee    Fee basis, rate, period and offsets.'],
  ['  Transfers         Secondary transfers effective on or before the call date.'],
  ['  Expected_Output   Regression fixture. The engine checks its result against it.'],
  [''],
  ['This tab, and any tab not listed above, is ignored.'],
];

// ---------------------------------------------------------------------------

/** Assemble the workbook, with the Expected_Output tab only once it is known. */
function build(expected: Row[] | null): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const add = (rows: Row[], name: string) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  add(README, 'README');
  add(SETUP, 'Fund_Setup');
  add(REGISTER, 'LP_Register');
  add(COMPONENTS, 'Call_Components');
  add(FEE, 'Management_Fee');
  add(TRANSFERS, 'Transfers');
  if (expected) add(expected, 'Expected_Output');
  return wb;
}

/**
 * Parse exactly as the Set up screen does, including its baseline.
 *
 * The baseline matters: `parseWorkbook` layers onto it field by field, so a tab
 * this workbook left blank would inherit the illustrative fund's value. Parsing
 * against the same baseline the app uses is what proves nothing leaks through.
 */
function parse(wb: XLSX.WorkBook): CallModel {
  return parseWorkbook(
    XLSX as unknown as WorkbookReader,
    wb as unknown as WorkbookLike,
    newModelFromTemplate(),
  );
}

/** The Expected_Output tab, built from a computed call. */
function expectedOutputTab(result: ReturnType<typeof compute>): Row[] {
  const componentColumns = COMPONENT_ROWS.map((c) => String(c[1]).replace(/ /g, '_'));

  const header: Row = [
    'LP_ID', 'LP_Name', 'Commitment', 'Opening_UCC', 'Opening_Paid_In',
    ...componentColumns, 'Fee_Rate', 'Fee_Gross', 'Fee_Offset', 'Fee_Net',
    'Total_Call', 'Reduces_Unfunded_Amt', 'Closing_UCC', 'Closing_Paid_In',
  ];

  const body: Row[] = result.rows.map((r) => [
    r.LP_ID, String(r.LP_Name), Number(r.Commitment), r.openUCC, r.openPaid,
    ...COMPONENT_ROWS.map((c) => r.comps.find((x) => x.id === c[0])?.amt ?? 0),
    r.feeRate, r.feeGross, r.feeOffset, r.feeNet,
    r.total, r.reduces, r.closingUCC, r.closingPaid,
  ]);

  const t = result.totals;
  // A blank LP_ID is how the parser knows the table has ended, so the TOTAL row
  // reads as a footer rather than as a ninth investor.
  const total: Row = [
    '', 'TOTAL', t.Commitment, t.openUCC, t.openPaid,
    ...t.comps, '', t.feeGross, t.feeOffset, t.feeNet,
    t.total, t.reduces, t.closingUCC, t.closingPaid,
  ];

  const blanks = header.slice(1).map(() => '');
  return [
    ['Expected Output — regression fixture', ...blanks],
    ['The engine compares its own result against these rows on every compute.', ...blanks],
    header,
    ...body,
    total,
  ];
}

describe('the sample input workbook', () => {
  // Built without Expected_Output first: the fixture is the engine's own
  // output, so it can only be written once the call has been computed.
  const draft = parse(build(null));
  const drafted = compute(draft);
  const workbook = build(expectedOutputTab(drafted));
  const model = parse(workbook);
  const result = compute(model);

  it('inherits nothing from the illustrative baseline', () => {
    expect(model.setup.Fund_Name).toBe('Meridian Growth Partners III, L.P.');
    expect(model.setup.Rounding_Plug_LP_ID).toBe('LP04');
    expect(model.fee.Fee_Exempt_LP_IDs).toBe('GP01');
    // The illustrative fund's LP05 → LP06 transfer must not survive.
    expect(model.transfers).toEqual([]);
    expect(model.lps.map((l) => l.LP_ID)).toEqual(
      ['LP01', 'LP02', 'LP03', 'LP04', 'LP05', 'LP06', 'LP07', 'GP01'],
    );
  });

  it('describes a call that ties out, with nothing to warn about', () => {
    expect(result.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(result.checks.filter((c) => c.level === 'warn')).toEqual([]);
  });

  it('carries an Expected_Output fixture that the engine agrees with', () => {
    // Every figure has to survive being written to a cell and read back, so
    // this is a round-trip check on the parser, not on the arithmetic.
    expect(model.golden).toHaveLength(LP_ROWS.length);
    expect(result.goldenDiffs).toEqual([]);
  });

  it('gives every investor an address to send the notice to', () => {
    expect(result.rows.every((r) => String(r.Contact_Email || '').includes('@'))).toBe(true);
  });

  it('matches the workbook committed in samples/', () => {
    if (process.env.WRITE_SAMPLE) {
      writeFileSync(SAMPLE_PATH, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    }

    const committed = parse(
      XLSX.read(readFileSync(SAMPLE_PATH), { type: 'buffer' }),
    );
    expect(committed).toEqual(model);
  });
});

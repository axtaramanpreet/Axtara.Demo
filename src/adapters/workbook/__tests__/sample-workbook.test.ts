/**
 * The sample input workbook in `samples/`.
 *
 * This file is the sample's source of truth: the tab layout and every figure
 * live here, and the committed `.xlsx` is generated from them. Regenerate with
 *
 *   WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/sample-workbook.test.ts
 *
 * Without that flag the test only reads. It parses the definition through the
 * real parser, checks the call ties out and agrees with the Expected_Output
 * figures, and then checks the committed file parses to the same model — so the
 * shipped sample cannot drift away from the definition, and a sample that would
 * show a FAIL on upload cannot be shipped.
 *
 * The Expected_Output figures are literals taken from the delivered spec
 * engine, not from this one. See the comment on `EXPECTED` for why that
 * distinction is the whole point of the tab.
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

/**
 * The Expected_Output tab: this fund's figures as produced by the delivered
 * spec engine, `design_handoff_capital_call_engine 2/engine.js`, transcribed
 * here as literals.
 *
 * Deliberately NOT generated from this engine's own output. A fixture an engine
 * wrote for itself only shows the engine is self-consistent; it would agree
 * with a wrong answer just as happily, and the green check in the Checks tab
 * would mean nothing. These came from a separate implementation, so a
 * regression in the port shows up as a diff.
 *
 * Do not regenerate from `compute()`. If a figure here looks wrong, the spec
 * engine and the port disagree, and that disagreement is the finding.
 *
 * Columns: LP_ID, the five components in order, then the fee and roll-forward.
 */
const EXPECTED: Row[] = [
  ['LP01', 1614583.33, 885416.67, 325520.83, 74218.75, 31250, 0.0175, 33687.5, 21377.09, 12310.41, 2943299.99, 2912049.99, 13337950.01, 11693299.99],
  ['LP02', 775000, 425000, 156250, 35625, 15000, 0.0175, 16170, 10261.01, 5908.99, 1412783.99, 1397783.99, 6402216.01, 5612783.99],
  ['LP03', 387500, 212500, 78125, 17812.5, 7500, 0.015, 6930, 4397.57, 2532.43, 705969.93, 698469.93, 3201530.07, 2805969.93],
  ['LP04', 1937500, 1062500, 390625, 89062.49, 37500, 0.0175, 40425, 25652.5, 14772.5, 3531959.99, 3494459.99, 16005540.01, 14031959.99],
  ['LP05', 613541.67, 336458.33, 123697.92, 28203.13, 11875, 0.0175, 12801.25, 8123.29, 4677.96, 1118454.01, 1106579.01, 5068420.99, 4443454.01],
  ['LP06', 290625, 159375, 58593.75, 13359.38, 5625, 0.0175, 6063.75, 3847.87, 2215.88, 529794.01, 524169.01, 2400830.99, 2104794.01],
  ['LP07', 516666.67, 283333.33, 104166.67, 23750, 10000, 0.0175, 10780, 6840.67, 3939.33, 941856, 931856, 4268144, 3741856],
  ['GP01', 64583.33, 35416.67, 13020.83, 2968.75, 1250, 0, 0, 0, 0, 117239.58, 115989.58, 534010.42, 467239.58],
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

/** The Expected_Output tab, laid out around the `EXPECTED` figures. */
function expectedOutputTab(): Row[] {
  const componentColumns = COMPONENT_ROWS.map((c) => String(c[1]).replace(/ /g, '_'));

  const header: Row = [
    'LP_ID', 'LP_Name', 'Commitment', 'Opening_UCC', 'Opening_Paid_In',
    ...componentColumns, 'Fee_Rate', 'Fee_Gross', 'Fee_Offset', 'Fee_Net',
    'Total_Call', 'Reduces_Unfunded_Amt', 'Closing_UCC', 'Closing_Paid_In',
  ];

  // The opening columns are inputs echoed back for the reader's benefit; the
  // engine skips them when diffing. Taken from the register so the two tabs
  // cannot disagree.
  const body: Row[] = EXPECTED.map((row) => {
    const lp = LP_ROWS.find((l) => l[0] === row[0]);
    if (!lp) throw new Error(`Expected_Output names ${row[0]}, which is not in LP_Register`);
    return [row[0], lp[1], lp[3], lp[5], lp[4], ...row.slice(1)];
  });

  // A blank LP_ID is how the parser knows the table has ended, so this reads as
  // a footer rather than as a ninth investor. Its figures are never checked.
  // Rounded, because summing cents in binary floating point drifts.
  const down = (rows: Row[], column: number) =>
    Math.round(rows.reduce((s, r) => s + Number(r[column]), 0) * 100) / 100;

  const componentTotals = COMPONENT_ROWS.map((_, i) => down(EXPECTED, 1 + i));
  const feeAndRollForward = [7, 8, 9, 10, 11, 12, 13].map((c) => down(EXPECTED, c));

  const total: Row = [
    '', 'TOTAL',
    down(LP_ROWS, 3), // Commitment
    down(LP_ROWS, 5), // Opening_UCC
    down(LP_ROWS, 4), // Opening_Paid_In
    ...componentTotals,
    '', // Fee_Rate does not total
    ...feeAndRollForward,
  ];

  const blanks = header.slice(1).map(() => '');
  return [
    ['Expected Output — golden test case', ...blanks],
    [
      'Figures produced by the delivered spec engine. The app checks its own result against them.',
      ...blanks,
    ],
    header,
    ...body,
    total,
  ];
}

describe('the sample input workbook', () => {
  const workbook = build(expectedOutputTab());
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

  it('computes to the spec engine’s figures, to the cent', () => {
    // `EXPECTED` came from the delivered spec engine, not from this one, so
    // this is a real check on the arithmetic and not a tautology. It also
    // covers the round trip: every figure has to survive being written to a
    // cell and read back for the diff to come out empty.
    expect(model.golden).toHaveLength(LP_ROWS.length);
    expect(result.goldenDiffs).toEqual([]);
  });

  it('names only investors that are in the register', () => {
    // A typo in an Expected_Output LP_ID would otherwise surface as a missing
    // investor on upload rather than as a broken fixture.
    const ids = LP_ROWS.map((l) => l[0]);
    expect(EXPECTED.map((r) => r[0])).toEqual(ids);
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

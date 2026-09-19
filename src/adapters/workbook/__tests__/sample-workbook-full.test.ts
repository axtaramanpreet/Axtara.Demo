/**
 * The path-coverage sample workbook in `samples/`.
 *
 * Where `sample-workbook.test.ts` ships a clean call that raises nothing, this
 * one is built to walk down as many of the engine's branches as a single
 * workbook can reach: three allocation bases, an excused investor, a component
 * called outside commitment, an unknown basis, a full transfer and a partial
 * one, all three reasons a transfer is skipped, a defaulted investor, a
 * side-letter rate, two kinds of fee exemption, all three offset methods, an
 * investor called beyond their unfunded commitment, and an organizational
 * expense over its cap.
 *
 * So it raises warnings **by design**. The expected checks are asserted below,
 * line for line, which is what separates "working as intended" from "broken" —
 * the reason the other sample stays clean.
 *
 * Regenerate with
 *
 *   WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/sample-workbook-full.test.ts
 *
 * Input tabs only, and no Expected_Output: that tab describes the sheet the
 * engine *produces*, so no client would ever fill one in. Its figures live
 * below as assertions, taken from the delivered spec engine rather than from
 * this one.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import {
  assemble,
  parseAsApp,
  parseCommitted,
  publishIfRequested,
  type Row,
  type Tab,
} from './sample-support';

const SAMPLE_PATH = fileURLToPath(
  new URL('../../../../samples/thornfield-continuation-fund-ii-call-7.xlsx', import.meta.url),
);

// ---------------------------------------------------------------------------
// The fund
//
// A continuation vehicle at its seventh call. Opening balances are deliberately
// uneven — investors are drawn anywhere from 25% to 90% — so a component
// allocated on unfunded commitment gives visibly different shares from one
// allocated on commitment. In the other sample every investor is drawn to the
// same percentage, which makes those two bases produce identical numbers and
// the UCC column prove nothing.
// ---------------------------------------------------------------------------

// Every field is written with a real value. `readKeyValues` skips rows whose
// value cell is blank, so a field left empty here would silently inherit the
// illustrative fund's value rather than reading as unset.
const SETUP: Row[] = [
  ['Fund Setup', '', ''],
  ['One row per field. Enter values in the Value column.', '', ''],
  ['Field', 'Value', 'Notes / allowed values'],
  ['Fund_Name', 'Thornfield Continuation Fund II, L.P.', 'Free text; shown on every notice.'],
  ['GP_Name', 'Thornfield GP II LLC', 'The general partner, named in the notice letter.'],
  ['Reporting_Currency', 'USD', 'ISO code.'],
  ['Call_Number', 7, 'Integer. Increment each call.'],
  ['Call_Date', '2026-09-30', 'Effective date of the call (YYYY-MM-DD).'],
  ['Payment_Due_Date', '2026-10-15', 'When LP wires are due.'],
  ['Default_Mgmt_Fee_Rate_Annual', 0.015, 'Fraction. 0.015 = 1.50%.'],
  ['Default_Mgmt_Fee_Basis', 'Commitment', 'Commitment | Invested_Capital | NAV.'],
  ['Mgmt_Fee_Period_Fraction', 0.25, 'Portion of the annual fee called now. 0.25 = one quarter.'],
  ['Org_Expense_Cap', 200000, 'Lifetime cap on organizational expenses.'],
  ['Rounding_Decimals', 2, 'Decimal places for every allocation.'],
  ['Rounding_Plug_LP_ID', 'LP04', 'Absorbs the rounding residual. Largest commitment.'],
  ['Signatory_Name', 'Baljeet Singh', 'Who signs the notice.'],
  ['Signatory_Title', 'Fund Manager', 'Their title, under the name.'],
  ['Prepared_By', 'Fund Administration', 'Traceability.'],
];

const LP_HEADER: Row = [
  'LP_ID', 'LP_Name', 'LP_Type', 'Commitment', 'Opening_Paid_In', 'Opening_UCC',
  'Opening_Invested_Capital', 'Mgmt_Fee_Rate_Override', 'Fee_Exempt', 'Status',
  'Contact_Email', 'Side_Letter_Ref', 'Notes',
];

// Drawn percentages vary on purpose: 60, 25, 45, 35, 50, 30, 40, 90, 30, 35.
// Opening_Paid_In and Opening_UCC still sum to Commitment for each investor.
const LP_ROWS: Row[] = [
  ['LP01', 'Ashcombe Pension Scheme', 'LP', 30000000, 18000000, 12000000, 15000000, '', 'N', 'Active', 'treasury@ashcombe-ps.example', '', 'Drawn 60%'],
  ['LP02', 'Brightwater Endowment', 'LP', 15000000, 3750000, 11250000, 3000000, '', 'N', 'Active', 'privatemarkets@brightwater.example', '', 'Drawn 25%; also transferee of LP06'],
  ['LP03', 'Calder Family Trust', 'LP', 8000000, 3600000, 4400000, 3000000, 0.0125, 'N', 'Active', 'ops@caldertrust.example', 'SL-2022-07', 'Mgmt fee reduced to 1.25% per side letter; excused from the regulated asset'],
  ['LP04', 'Draycott Assurance plc', 'LP', 40000000, 14000000, 26000000, 11500000, '', 'N', 'Active', 'altinvestments@draycott.example', '', 'Largest commitment; rounding plug'],
  ['LP05', 'Elmsworth Nominees Limited', 'LP', 10000000, 5000000, 5000000, 4200000, '', 'N', 'Active', 'fundops@elmsworth.example', '', 'Transfers out in full before this call'],
  ['LP06', 'Fernbank Foundation', 'LP', 6000000, 1800000, 4200000, 1500000, '', 'N', 'Active', 'finance@fernbank.example', '', 'Transfers 30% to LP02 before this call'],
  ['LP07', 'Garrowby Capital SCSp', 'LP', 12000000, 4800000, 7200000, 4000000, '', 'N', 'Active', 'capitalcalls@garrowby.example', '', 'Luxembourg feeder'],
  ['LP09', 'Hallamshire Mutual', 'LP', 5000000, 4500000, 500000, 3800000, '', 'N', 'Active', 'investments@hallamshire.example', 'SL-2021-02', 'Drawn 90%; little unfunded commitment left'],
  ['LP10', 'Ivywood Partners LLC', 'LP', 7000000, 2100000, 4900000, 1700000, '', 'N', 'Defaulted', 'notices@ivywood.example', '', 'In default; excluded from this call'],
  ['GP01', 'Thornfield GP II LLC', 'GP', 2000000, 700000, 1300000, 560000, '', 'Y', 'Active', 'finance@thornfieldgp.example', '', 'GP commitment; exempt from the management fee'],
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

// Component names double as column headings on the allocation sheet the app
// exports, so they stay free of punctuation and share no leading words.
const COMPONENT_ROWS: Row[] = [
  ['D1', 'Project Aurora', 'Deal', 8000000, 'Commitment', 'Y', '', 'Allocated on committed capital.'],
  ['D2', 'Project Basalt', 'Deal', 4500000, 'UCC', 'Y', '', 'Allocated on UNFUNDED commitment — gives different shares from D1 because investors are unevenly drawn.'],
  ['D3', 'Project Cinder', 'Deal', 2400000, 'Invested_Capital', 'Y', '', 'Allocated on invested capital.'],
  ['D4', 'Regulated Asset Purchase', 'Deal', 1800000, 'Commitment', 'Y', 'LP03, LP99', 'LP03 is excused on regulatory grounds. LP99 does not exist — the engine should say so rather than ignore it.'],
  ['E1', 'Fund Operating Expenses', 'Partnership Expense', 420000, 'Commitment', 'Y', '', 'Audit, tax, administration and custody for the period.'],
  ['E2', 'Placement Agent Fee', 'Partnership Expense', 150000, 'NAV', 'Y', '', 'Allocation_Basis is not one the engine supports — it should warn and fall back to Commitment.'],
  ['E3', 'Organizational True Up', 'Organizational Expense', 260000, 'Commitment', 'N', '', 'OUTSIDE commitment, and over the 200,000 cap — both should be reported.'],
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
  ['Fee_Basis', 'Commitment', 'Charged on committed capital.', ''],
  ['Default_Fee_Rate_Annual', 0.015, 'Fraction. 0.015 = 1.50%.', ''],
  ['Fee_Period_Fraction', 0.25, 'Portion of the annual fee called now. 0.25 = one quarter.', ''],
  ['Reduces_Unfunded', 'Y', 'Y if the fee is drawn from commitment.', ''],
  ['Fee_Exempt_LP_IDs', 'GP01, LP09', 'Comma-separated LP_IDs charged 0%. GP01 is also flagged on its own row.', ''],
  ['', '', '', ''],
  ['Offsets (reduce the gross fee)', '', '', ''],
  ['Offset_ID', 'Description', 'Amount', 'Allocation_Method'],
  ['O1', 'Portfolio company monitoring fees', 85000, 'Pro-rata to gross fee'],
  ['O2', 'Placement fee rebate', 40000, 'Commitment'],
  ['O3', 'Transaction fee sharing', 25000, 'Invested_Capital'],
  ['O4', 'Expired offset carryforward', 0, 'Pro-rata to gross fee'],
];

const TRANSFER_HEADER: Row = [
  'Transfer_ID', 'Effective_Date', 'From_LP_ID', 'To_LP_ID', 'To_LP_Name_if_new', 'Transfer_Type',
  'Transfer_Pct', 'Transfers_Commitment', 'Transfers_Paid_In', 'Transfers_UCC', 'Notes',
];

// Two apply, three are refused for the three different reasons the engine has.
const TRANSFER_ROWS: Row[] = [
  ['T1', '2026-06-30', 'LP05', 'LP08', 'Harcourt Secondaries II', 'Full', 1, 'Y', 'Y', 'Y', 'APPLIES. LP05 leaves the fund; LP08 is new to the register.'],
  ['T2', '2026-07-15', 'LP06', 'LP02', '', 'Partial', 0.3, 'Y', 'Y', 'Y', 'APPLIES. 30% of LP06 to LP02, who is already in the register.'],
  ['T3', '2027-03-31', 'LP07', 'LP20', 'Meltham Nominees', 'Partial', 0.25, 'Y', 'Y', 'Y', 'NOT APPLIED: effective after the call date. Reported, not dropped.'],
  ['T4', '2026-05-01', 'LP88', 'LP21', 'Unknown Transferee', 'Partial', 0.5, 'Y', 'Y', 'Y', 'NOT APPLIED: From_LP_ID is not in the register.'],
  ['T5', '2026-05-01', 'LP04', 'LP22', 'Overreach Capital', 'Partial', 1.4, 'Y', 'Y', 'Y', 'NOT APPLIED: Transfer_Pct is above 1.'],
];

const TRANSFERS: Row[] = [
  ['Transfers', '', '', '', '', '', '', '', '', '', ''],
  ['Applied BEFORE the call is allocated, and only when effective on or before the call date.', '', '', '', '', '', '', '', '', '', ''],
  TRANSFER_HEADER,
  ...TRANSFER_ROWS,
];

const README: Row[] = [
  ['Capital Call Engine — Input Workbook (path coverage)'],
  [''],
  ['Thornfield Continuation Fund II, L.P. — Call 7, dated 2026-09-30.'],
  [''],
  ['This workbook is built to exercise the engine, not to look tidy. It'],
  ['RAISES WARNINGS ON PURPOSE. Expected on upload:'],
  [''],
  ['  WARN  Regulated Asset Purchase: excused LP "LP99" is not in the register'],
  ['  WARN  Placement Agent Fee: unknown Allocation_Basis "NAV"'],
  ['  WARN  LP09 Hallamshire Mutual: call exceeds unfunded commitment'],
  ['  WARN  Organizational expense 260,000 over the 200,000 cap'],
  ['  INFO  Transfers T3, T4 and T5 not applied, each for a different reason'],
  [''],
  ['Nothing should FAIL.'],
  [''],
  ['Tabs the engine reads: Fund_Setup, LP_Register, Call_Components,'],
  ['Management_Fee, Transfers. This tab is ignored.'],
  [''],
  ['There is no expected-output tab: the allocation sheet is what the app'],
  ['produces from these inputs, not something you fill in.'],
];

const TABS: readonly Tab[] = [
  ['README', README],
  ['Fund_Setup', SETUP],
  ['LP_Register', REGISTER],
  ['Call_Components', COMPONENTS],
  ['Management_Fee', FEE],
  ['Transfers', TRANSFERS],
];

/**
 * What this call should come to, per investor.
 *
 * Produced by the delivered spec engine, `design_handoff_capital_call_engine
 * 2/engine.js`, and transcribed here as literals. Deliberately NOT generated
 * from this engine's own output: a fixture an engine wrote for itself only
 * shows the engine is self-consistent, and would agree with a wrong answer
 * just as happily.
 *
 * Columns: LP_ID, the seven components in order, then the fee and the
 * roll-forward. LP05 and LP10 are on the roster but not in the call — LP05
 * transferred out, LP10 is in default — so their figures are all zero.
 */
const EXPECTED: Row[] = [
  ['LP01', 1875000, 751565.76, 773195.88, 450000, 98437.5, 35156.25, 60937.5, 0.015, 112500, 40112.81, 72387.19, 4116680.08, 4055742.58, 7944257.42, 22116680.08],
  ['LP02', 1050000, 783507.31, 177835.05, 252000, 55125, 19687.5, 34125, 0.015, 63000, 19530.71, 43469.29, 2415749.15, 2381624.15, 10128375.85, 6705749.15],
  ['LP03', 500000, 275574.11, 154639.18, 'excused', 26250, 9375, 16250, 0.0125, 25000, 9157.26, 15842.74, 997931.03, 981681.03, 3418318.97, 4597931.03],
  ['LP04', 2500000, 1628392.49, 592783.49, 600000, 131250, 46874.99, 81250, 0.015, 150000, 48448.17, 101551.83, 5682102.8, 5600852.8, 20399147.2, 19682102.8],
  // LP05 left through a full transfer: every balance moved to LP08, so its
  // closing position is zero rather than its opening one.
  ['LP05', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ['LP06', 262500, 184133.61, 54123.71, 63000, 13781.25, 4921.88, 8531.25, 0.015, 15750, 4993.76, 10756.24, 601747.94, 593216.69, 2346783.31, 1861747.94],
  ['LP07', 750000, 450939.46, 206185.57, 180000, 39375, 14062.5, 24375, 0.015, 45000, 14860.29, 30139.71, 1695077.24, 1670702.24, 5529297.76, 6495077.24],
  // LP09's call against commitment exceeds what it had unfunded, so its closing
  // unfunded commitment goes negative. Reported as a warning, not corrected.
  ['LP09', 312500, 31315.24, 195876.29, 75000, 16406.25, 5859.38, 10156.25, 0, 0, 0, 0, 647113.41, 636957.16, -136957.16, 5147113.41],
  // LP10 is in default: on the roster, out of the call, balances untouched.
  ['LP10', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4900000, 2100000],
  ['GP01', 125000, 81419.62, 28865.98, 30000, 6562.5, 2343.75, 4062.5, 0, 0, 0, 0, 278254.35, 274191.85, 1025808.15, 978254.35],
  ['LP08', 625000, 313152.4, 216494.85, 150000, 32812.5, 11718.75, 20312.5, 0.015, 37500, 12897, 24603, 1394094, 1373781.5, 3626218.5, 6394094],
];

/** Column names for `EXPECTED`, so a failure says which figure is wrong. */
const EXPECTED_COLUMNS = [
  ...COMPONENT_ROWS.map((c) => String(c[1])),
  'Fee_Rate', 'Fee_Gross', 'Fee_Offset', 'Fee_Net',
  'Total_Call', 'Reduces_Unfunded_Amt', 'Closing_UCC', 'Closing_Paid_In',
];

describe('the path-coverage sample workbook', () => {
  const workbook = assemble(TABS);
  const model = parseAsApp(workbook);
  const result = compute(model);

  const checkTexts = (level: string) =>
    result.checks.filter((c) => c.level === level).map((c) => c.text);

  it('inherits nothing from the illustrative baseline', () => {
    expect(model.setup.Fund_Name).toBe('Thornfield Continuation Fund II, L.P.');
    expect(model.setup.Rounding_Plug_LP_ID).toBe('LP04');
    expect(model.setup.Org_Expense_Cap).toBe(200000);
    expect(model.fee.Fee_Exempt_LP_IDs).toBe('GP01, LP09');
    expect(model.transfers.map((t) => t.Transfer_ID)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(model.lps.map((l) => l.LP_ID)).toEqual(
      ['LP01', 'LP02', 'LP03', 'LP04', 'LP05', 'LP06', 'LP07', 'LP09', 'LP10', 'GP01'],
    );
  });

  it('carries input only, with no expected-output tab', () => {
    expect(workbook.SheetNames).toEqual([
      'README', 'Fund_Setup', 'LP_Register', 'Call_Components', 'Management_Fee', 'Transfers',
    ]);
    expect(model.golden).toBeNull();
  });

  it('nothing fails — every warning here is deliberate', () => {
    expect(checkTexts('fail')).toEqual([]);
  });

  it('applies the two effective transfers, and refuses the other three', () => {
    expect(result.transfers.applied.map((a) => a.t.Transfer_ID)).toEqual(['T1', 'T2']);

    // Each refusal is for a different reason, which is the point of having
    // three of them.
    expect(result.transfers.skipped.map((s) => [s.t.Transfer_ID, s.why])).toEqual([
      ['T3', 'effective 31 March 2027, after call date'],
      ['T4', 'From_LP_ID LP88 not in register'],
      ['T5', 'Transfer_Pct must be between 0 and 1'],
    ]);
  });

  it('takes the transferor out of the call and puts the transferee in', () => {
    const active = result.rows.filter((r) => r.isActive).map((r) => r.LP_ID);

    // LP05 left through a full transfer; LP10 is in default. Both stay on the
    // roster so the allocation table still shows them.
    expect(active).not.toContain('LP05');
    expect(active).not.toContain('LP10');
    expect(active).toContain('LP08');
    expect(result.roster.find((r) => r.LP_ID === 'LP05')?.Status).toBe('Transferred');

    // LP08 is new, and inherits LP05's whole position.
    const lp08 = result.rows.find((r) => r.LP_ID === 'LP08');
    expect(lp08?.LP_Name).toBe('Harcourt Secondaries II');
    expect(lp08?.Commitment).toBe(10000000);

    // LP02 was already in the register and gains 30% of LP06 on top of its own.
    expect(result.rows.find((r) => r.LP_ID === 'LP02')?.Commitment).toBe(16800000);
    expect(result.rows.find((r) => r.LP_ID === 'LP06')?.Commitment).toBe(4200000);
  });

  it('allocates each component on its own basis, with visibly different shares', () => {
    const lp01 = result.rows.find((r) => r.LP_ID === 'LP01')!;
    const amount = (id: string) => lp01.comps.find((c) => c.id === id)!.amt;

    // LP01 is drawn 60%, so it carries more of the commitment-based deal than
    // of the unfunded-based one. In the other sample these two would be equal.
    expect(amount('D1') / 8000000).toBeCloseTo(30 / 128, 6); //   30.0m of 128.00m committed
    expect(amount('D2') / 4500000).toBeCloseTo(12 / 71.85, 6); // 12.0m of  71.85m unfunded
    expect(amount('D3') / 2400000).toBeCloseTo(15 / 46.56, 6); // 15.0m of  46.56m invested
  });

  it('excuses LP03 from the regulated asset and no one else', () => {
    const lp03 = result.rows.find((r) => r.LP_ID === 'LP03')!;
    const d4 = lp03.comps.find((c) => c.id === 'D4')!;

    expect(d4.excused).toBe(true);
    expect(d4.amt).toBe(0);
    expect(lp03.excusedFrom).toEqual(['Regulated Asset Purchase']);

    // The others carry it in full: an excusal reallocates, it does not discount.
    const allocated = result.rows.reduce(
      (s, r) => s + r.comps.find((c) => c.id === 'D4')!.amt,
      0,
    );
    expect(allocated).toBeCloseTo(1800000, 2);
  });

  it('charges the side-letter rate, and nothing to either exempt investor', () => {
    expect(result.rows.find((r) => r.LP_ID === 'LP03')?.feeRate).toBe(0.0125);
    expect(result.rows.find((r) => r.LP_ID === 'LP01')?.feeRate).toBe(0.015);
    // GP01 is flagged on its own row; LP09 is named in Fee_Exempt_LP_IDs.
    expect(result.rows.find((r) => r.LP_ID === 'GP01')?.feeGross).toBe(0);
    expect(result.rows.find((r) => r.LP_ID === 'LP09')?.feeGross).toBe(0);
  });

  it('ties all three offset methods, and ignores the zero one', () => {
    expect(result.fee.offsets.map((o) => o.Offset_ID)).toEqual(['O1', 'O2', 'O3']);
    expect(result.fee.offsetTotal).toBeCloseTo(150000, 2);
    expect(result.fee.offsetTotal).toBeLessThan(result.fee.grossTotal);
  });

  it('separates what is called inside commitment from what is called on top', () => {
    const lp01 = result.rows.find((r) => r.LP_ID === 'LP01')!;
    // Only E3, the organizational true-up, is flagged Reduces_Unfunded = N.
    expect(lp01.outside).toBeCloseTo(lp01.comps.find((c) => c.id === 'E3')!.amt, 2);
    expect(lp01.reduces + lp01.outside).toBeCloseTo(lp01.total, 2);
  });

  it('raises exactly the four warnings this fund is built to raise', () => {
    expect(checkTexts('warn')).toEqual([
      'Regulated Asset Purchase: excused LP "LP99" is not in the register.',
      'Placement Agent Fee: unknown Allocation_Basis "NAV", defaulted to Commitment.',
      'LP09 Hallamshire Mutual: call against commitment (636,957.16) exceeds unfunded commitment (500,000.00).',
      'Organizational expense 260,000.00 vs cap 200,000.00 — excess treated per LPA.',
    ]);
  });

  it('computes to the spec engine’s figures, to the cent', () => {
    // `EXPECTED` came from the delivered spec engine, not from this one, so
    // this is a real check on the arithmetic rather than a tautology.
    expect(EXPECTED.map((r) => r[0])).toEqual(result.rows.map((r) => r.LP_ID));

    EXPECTED.forEach((expected) => {
      const row = result.rows.find((r) => r.LP_ID === expected[0]);
      expect(row, `${expected[0]} is missing from the call`).toBeDefined();

      const actual: (string | number)[] = [
        ...COMPONENT_ROWS.map((c) => {
          const cell = row!.comps.find((x) => x.id === c[0])!;
          // Written the way the exported sheet writes it, so an excusal cannot
          // be read as a zero.
          return cell.excused ? 'excused' : cell.amt;
        }),
        row!.feeRate, row!.feeGross, row!.feeOffset, row!.feeNet,
        row!.total, row!.reduces, row!.closingUCC, row!.closingPaid,
      ];

      actual.forEach((value, i) => {
        const label = `${expected[0]} · ${EXPECTED_COLUMNS[i]}`;
        if (typeof expected[i + 1] === 'string') {
          expect(value, label).toBe(expected[i + 1]);
        } else {
          expect(value, label).toBeCloseTo(Number(expected[i + 1]), 2);
        }
      });
    });
  });

  it('gives every investor in the call an address to send the notice to', () => {
    const active = result.rows.filter((r) => r.isActive);
    // LP08 arrived through a transfer and has no address of its own: a real
    // transferee has to be reached for before the notice can go out, and the
    // Notices tab is where that shows up.
    expect(active.filter((r) => !String(r.Contact_Email || '').includes('@')).map((r) => r.LP_ID))
      .toEqual(['LP08']);
  });

  it('matches the workbook committed in samples/', () => {
    publishIfRequested(SAMPLE_PATH, workbook);
    expect(parseCommitted(SAMPLE_PATH)).toEqual(model);
  });
});

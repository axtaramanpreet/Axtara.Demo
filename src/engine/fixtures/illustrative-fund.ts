/**
 * The illustrative fund shipped with the accountant's input template.
 *
 * This is both the "Load illustrative template data" option in the Source step
 * and the engine's primary regression fixture. The `golden` rows are the
 * Expected_Output tab of `uploads/capcall_input.xlsx`, transcribed exactly —
 * they are the accountant's own numbers, not engine output, which is what makes
 * them worth testing against.
 *
 * It deliberately exercises the awkward cases: an LP with a side-letter fee
 * rate (LP03), a fee-exempt GP (GP01), a component allocated on unfunded rather
 * than committed capital (Deal Z), a component called outside commitment
 * (Organizational Expense), a fee offset, and a transfer dated after the call
 * so it is reported but not applied.
 */

import type { CallModel } from '../types';

export const ILLUSTRATIVE_FUND: CallModel = {
  setup: {
    Fund_Name: 'Illustrative Fund II, L.P.',
    Reporting_Currency: 'USD',
    Call_Number: 2,
    Call_Date: '2026-09-30',
    Payment_Due_Date: '2026-10-14',
    Default_Mgmt_Fee_Rate_Annual: 0.02,
    Default_Mgmt_Fee_Basis: 'Commitment',
    Mgmt_Fee_Period_Fraction: 0.25,
    Org_Expense_Cap: 1500000,
    Rounding_Decimals: 2,
    Rounding_Plug_LP_ID: 'LP04',
    Prepared_By: 'Ops Team',
  },

  lps: [
    {
      LP_ID: 'LP01',
      Contact_Email: 'treasury@alphapension.example',
      LP_Name: 'Alpha Pension Trust',
      LP_Type: 'LP',
      Commitment: 10000000,
      Opening_Paid_In: 2000000,
      Opening_UCC: 8000000,
      Opening_Invested_Capital: 1800000,
      Mgmt_Fee_Rate_Override: '',
      Fee_Exempt: 'N',
      Status: 'Active',
      Side_Letter_Ref: '',
      Notes: '',
    },
    {
      LP_ID: 'LP02',
      Contact_Email: 'investments@betaendowment.example',
      LP_Name: 'Beta University Endowment',
      LP_Type: 'LP',
      Commitment: 7500000,
      Opening_Paid_In: 750000,
      Opening_UCC: 6750000,
      Opening_Invested_Capital: 675000,
      Mgmt_Fee_Rate_Override: '',
      Fee_Exempt: 'N',
      Status: 'Active',
      Side_Letter_Ref: '',
      Notes: '',
    },
    {
      LP_ID: 'LP03',
      Contact_Email: 'ops@gammafo.example',
      LP_Name: 'Gamma Family Office',
      LP_Type: 'LP',
      Commitment: 5000000,
      Opening_Paid_In: 2000000,
      Opening_UCC: 3000000,
      Opening_Invested_Capital: 1800000,
      Mgmt_Fee_Rate_Override: 0.01,
      Fee_Exempt: 'N',
      Status: 'Active',
      Side_Letter_Ref: 'SL-2024-03',
      Notes: 'Mgmt fee reduced to 1% per side letter',
    },
    {
      LP_ID: 'LP04',
      Contact_Email: 'altinvest@deltainsurance.example',
      LP_Name: 'Delta Insurance Co',
      LP_Type: 'LP',
      Commitment: 15000000,
      Opening_Paid_In: 1500000,
      Opening_UCC: 13500000,
      Opening_Invested_Capital: 1350000,
      Mgmt_Fee_Rate_Override: '',
      Fee_Exempt: 'N',
      Status: 'Active',
      Side_Letter_Ref: '',
      Notes: 'Largest commitment; rounding plug',
    },
    {
      LP_ID: 'LP05',
      Contact_Email: 'pe@epsilonswf.example',
      LP_Name: 'Epsilon Sovereign Fund',
      LP_Type: 'LP',
      Commitment: 12500000,
      Opening_Paid_In: 3500000,
      Opening_UCC: 9000000,
      Opening_Invested_Capital: 3150000,
      Mgmt_Fee_Rate_Override: '',
      Fee_Exempt: 'N',
      Status: 'Active',
      Side_Letter_Ref: '',
      Notes: '',
    },
    {
      LP_ID: 'GP01',
      Contact_Email: 'finance@fundgp.example',
      LP_Name: 'Fund GP LLC',
      LP_Type: 'GP',
      Commitment: 500000,
      Opening_Paid_In: 50000,
      Opening_UCC: 450000,
      Opening_Invested_Capital: 45000,
      Mgmt_Fee_Rate_Override: '',
      Fee_Exempt: 'Y',
      Status: 'Active',
      Side_Letter_Ref: '',
      Notes: 'GP commitment; exempt from mgmt fee',
    },
  ],

  components: [
    {
      Component_ID: 'C1',
      Component_Name: 'Deal X',
      Category: 'Deal',
      Total_Amount: 3000000,
      Allocation_Basis: 'Commitment',
      Reduces_Unfunded: 'Y',
      Excused_LP_IDs: '',
      Notes: 'Allocated on committed capital.',
    },
    {
      Component_ID: 'C2',
      Component_Name: 'Deal Y',
      Category: 'Deal',
      Total_Amount: 2000000,
      Allocation_Basis: 'Commitment',
      Reduces_Unfunded: 'Y',
      Excused_LP_IDs: '',
      Notes: 'Allocated on committed capital.',
    },
    {
      Component_ID: 'C3',
      Component_Name: 'Deal Z',
      Category: 'Deal',
      Total_Amount: 1500000,
      Allocation_Basis: 'UCC',
      Reduces_Unfunded: 'Y',
      Excused_LP_IDs: '',
      Notes: 'Allocated on UNFUNDED commitment, not commitment.',
    },
    {
      Component_ID: 'C4',
      Component_Name: 'Partnership Expense',
      Category: 'Partnership Expense',
      Total_Amount: 200000,
      Allocation_Basis: 'Commitment',
      Reduces_Unfunded: 'Y',
      Excused_LP_IDs: '',
      Notes: 'Ongoing fund expense; inside commitment.',
    },
    {
      Component_ID: 'C5',
      Component_Name: 'Organizational Expense',
      Category: 'Organizational Expense',
      Total_Amount: 150000,
      Allocation_Basis: 'Commitment',
      Reduces_Unfunded: 'N',
      Excused_LP_IDs: '',
      Notes: 'OUTSIDE commitment: contributed but does NOT reduce unfunded.',
    },
  ],

  fee: {
    Fee_Basis: 'Commitment',
    Default_Fee_Rate_Annual: 0.02,
    Fee_Period_Fraction: 0.25,
    Reduces_Unfunded: 'Y',
    Fee_Exempt_LP_IDs: 'GP01',
    offsets: [
      {
        Offset_ID: 'O1',
        Description: 'GP transaction fee offset (100% sharing)',
        Amount: 50000,
        Allocation_Method: 'Pro-rata to gross fee',
      },
    ],
  },

  transfers: [
    {
      Transfer_ID: 'T1',
      Effective_Date: '2026-12-31',
      From_LP_ID: 'LP05',
      To_LP_ID: 'LP06',
      To_LP_Name_if_new: 'Zeta Capital Partners',
      Transfer_Type: 'Partial',
      Transfer_Pct: 0.4,
      Transfers_Commitment: 'Y',
      Transfers_Paid_In: 'Y',
      Transfers_UCC: 'Y',
      Notes: 'ILLUSTRATIVE: 40% of LP05 to new LP06, effective next call.',
    },
  ],

  // Transcribed from the Expected_Output tab. Do not regenerate from engine
  // output — the whole point is that these came from the accountant.
  golden: [
    { LP_ID: 'LP01', Deal_X: 594059.41, Deal_Y: 396039.6, Deal_Z: 294840.29, Partnership_Exp: 39603.96, Org_Exp: 29702.97, Fee_Gross: 50000, Fee_Offset: 10526.32, Fee_Net: 39473.68, Total_Call: 1393719.91, Reduces_Unfunded_Amt: 1364016.94, Closing_UCC: 6635983.06, Closing_Paid_In: 3393719.91 },
    { LP_ID: 'LP02', Deal_X: 445544.55, Deal_Y: 297029.7, Deal_Z: 248771.5, Partnership_Exp: 29702.97, Org_Exp: 22277.23, Fee_Gross: 37500, Fee_Offset: 7894.74, Fee_Net: 29605.26, Total_Call: 1072931.21, Reduces_Unfunded_Amt: 1050653.98, Closing_UCC: 5699346.02, Closing_Paid_In: 1822931.21 },
    { LP_ID: 'LP03', Deal_X: 297029.7, Deal_Y: 198019.8, Deal_Z: 110565.11, Partnership_Exp: 19801.98, Org_Exp: 14851.49, Fee_Gross: 12500, Fee_Offset: 2631.58, Fee_Net: 9868.42, Total_Call: 650136.5, Reduces_Unfunded_Amt: 635285.01, Closing_UCC: 2364714.99, Closing_Paid_In: 2650136.5 },
    { LP_ID: 'LP04', Deal_X: 891089.11, Deal_Y: 594059.42, Deal_Z: 497543, Partnership_Exp: 59405.94, Org_Exp: 44554.45, Fee_Gross: 75000, Fee_Offset: 15789.47, Fee_Net: 59210.53, Total_Call: 2145862.45, Reduces_Unfunded_Amt: 2101308, Closing_UCC: 11398692, Closing_Paid_In: 3645862.45 },
    { LP_ID: 'LP05', Deal_X: 742574.26, Deal_Y: 495049.5, Deal_Z: 331695.33, Partnership_Exp: 49504.95, Org_Exp: 37128.71, Fee_Gross: 62500, Fee_Offset: 13157.89, Fee_Net: 49342.11, Total_Call: 1705294.86, Reduces_Unfunded_Amt: 1668166.15, Closing_UCC: 7331833.85, Closing_Paid_In: 5205294.86 },
    { LP_ID: 'GP01', Deal_X: 29702.97, Deal_Y: 19801.98, Deal_Z: 16584.77, Partnership_Exp: 1980.2, Org_Exp: 1485.15, Fee_Gross: 0, Fee_Offset: 0, Fee_Net: 0, Total_Call: 69555.07, Reduces_Unfunded_Amt: 68069.92, Closing_UCC: 381930.08, Closing_Paid_In: 119555.07 },
  ],

  goldenSource: 'capcall_input.xlsx · Expected_Output',
};

/** Deep copy, so callers can edit a new call's inputs without touching the fixture. */
export function newModelFromTemplate(): CallModel {
  return structuredClone(ILLUSTRATIVE_FUND);
}

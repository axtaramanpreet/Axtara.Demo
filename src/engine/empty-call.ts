/**
 * A new, empty capital call.
 *
 * Everything is blank except the fund's own name, which is a fact the app
 * already knows, and whatever `defaults` carries — the general partner and who
 * signs, which a client sets once and reuses rather than retyping per call. Currency, dates, the fee, the rounding
 * policy and the plug investor are all decisions belonging to this fund, and
 * they arrive from the uploaded workbook, from carrying the previous call
 * forward, or from being typed in.
 *
 * A new call used to start from the illustrative fixture instead, so a real
 * first call arrived carrying another fund's economics — a 2% fee, a 1.5m
 * organizational cap, LP04 as the rounding plug — and the notice was headed
 * "Illustrative Fund II, L.P.". None of it had been chosen, and all of it
 * looked deliberate.
 *
 * The illustrative data is still one click away, on the Source step, where
 * loading it is an explicit act.
 */

import type { CallModel } from './types';

/** Fields a client sets once and reuses on every call. */
export interface CallDefaults {
  gpName?: string;
  signatoryName?: string;
  signatoryTitle?: string;
}

export function emptyCall(fundName: string, defaults: CallDefaults = {}): CallModel {
  return {
    setup: {
      Fund_Name: fundName,
      GP_Name: defaults.gpName ?? '',
      Reporting_Currency: '',
      Call_Number: '',
      Call_Date: '',
      Payment_Due_Date: '',
      Default_Mgmt_Fee_Rate_Annual: '',
      Default_Mgmt_Fee_Basis: '',
      Mgmt_Fee_Period_Fraction: '',
      Org_Expense_Cap: '',
      Rounding_Decimals: '',
      Rounding_Plug_LP_ID: '',
      Signatory_Name: defaults.signatoryName ?? '',
      Signatory_Title: defaults.signatoryTitle ?? '',
      Prepared_By: '',
    },
    lps: [],
    components: [],
    fee: {
      Fee_Basis: '',
      Default_Fee_Rate_Annual: '',
      Fee_Period_Fraction: '',
      Reduces_Unfunded: '',
      Fee_Exempt_LP_IDs: '',
      offsets: [],
    },
    transfers: [],
    // No Expected_Output: that is a fixture an accountant supplies to check the
    // engine against, not something a new call has.
    golden: null,
    goldenSource: '',
  };
}

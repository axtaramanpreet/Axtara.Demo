/**
 * Rolling one call's closing position into the next call's opening position.
 *
 * After a call is issued, what each investor has paid in has grown and their
 * unfunded commitment has shrunk. The next call starts from those closing
 * figures — otherwise every call would draw against the same stale balances and
 * the fund would over-call.
 */

import { compute } from './compute';
import { round } from './format';
import type { CallModel, LPRow } from './types';

/**
 * Build the next call's register from the previous call.
 *
 * Three things move:
 *   - closing paid-in becomes opening paid-in
 *   - closing unfunded becomes opening unfunded
 *   - invested capital grows by whatever was allocated to deals
 *
 * Invested capital counts deal components only. A partnership or organizational
 * expense is money called, but it is not capital invested in anything, and
 * including it would inflate the basis of every later call allocated on
 * invested capital.
 *
 * The roster comes from the computed result rather than the raw register, so
 * investors who arrived through a transfer are carried forward too, and anyone
 * who left by a full transfer keeps their `Transferred` status and drops out.
 */
export function carryForwardRegister(previous: CallModel): LPRow[] {
  const result = compute(previous);
  const decimals = result.d;

  return result.rows.map((row): LPRow => {
    const investedInDeals = row.comps
      .filter((c) => /deal/i.test(String(c.category ?? '')))
      .reduce((sum, c) => sum + c.amt, 0);

    return {
      LP_ID: row.LP_ID,
      LP_Name: row.LP_Name,
      LP_Type: row.LP_Type,
      Commitment: row.Commitment,
      Opening_Paid_In: row.closingPaid,
      Opening_UCC: row.closingUCC,
      Opening_Invested_Capital: round(
        Number(row.Opening_Invested_Capital ?? 0) + investedInDeals,
        decimals,
      ),
      Mgmt_Fee_Rate_Override: row.Mgmt_Fee_Rate_Override,
      Fee_Exempt: row.Fee_Exempt,
      Status: row.Status,
      Side_Letter_Ref: row.Side_Letter_Ref,
      Contact_Email: row.Contact_Email,
      Notes: row.Notes,
    };
  });
}

/**
 * The next call, seeded from the previous one.
 *
 * Fee configuration and rounding policy carry over, because they rarely change
 * between calls. The components do not: what is being called for is the one
 * thing that is different every time. Transfers do not carry either — an
 * applied transfer is spent, and one dated in the future has to be re-entered
 * deliberately rather than silently reapplied.
 */
export function nextCallFrom(previous: CallModel): CallModel {
  const previousNumber = Number(previous.setup.Call_Number ?? 0);

  return {
    setup: {
      ...previous.setup,
      Call_Number: previousNumber + 1,
      Call_Date: '',
      Payment_Due_Date: '',
    },
    lps: carryForwardRegister(previous),
    components: [],
    fee: { ...previous.fee, offsets: [] },
    transfers: [],
    golden: null,
    goldenSource: '',
  };
}

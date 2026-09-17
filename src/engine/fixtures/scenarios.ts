/**
 * Edge-case scenarios for the engine test suite.
 *
 * The accountant's Expected_Output fixture only covers the happy path: its one
 * transfer is dated after the call so it never applies, and no LP is excused
 * from anything. These scenarios deliberately drive the paths the fixture
 * leaves untouched — transfers that actually move money, excused investors,
 * fee-basis fallbacks, offsets larger than the fee, and allocations that cannot
 * be made at all.
 */

import type { CallModel } from '../types';
import { ILLUSTRATIVE_FUND } from './illustrative-fund';

/** Deep copy of the base fund, with `mutate` applied. Never touches the original. */
function variant(mutate: (m: CallModel) => void): CallModel {
  const m = structuredClone(ILLUSTRATIVE_FUND);
  mutate(m);
  return m;
}

export const SCENARIOS: Record<string, CallModel> = {
  /** The shipped template, unmodified. */
  base: structuredClone(ILLUSTRATIVE_FUND),

  /** A partial transfer dated before the call, so it actually moves balances. */
  partialTransferApplied: variant((m) => {
    m.transfers[0].Effective_Date = '2026-06-30';
  }),

  /** A full transfer: the transferor leaves the fund mid-life. */
  fullTransfer: variant((m) => {
    m.transfers[0].Effective_Date = '2026-06-30';
    m.transfers[0].Transfer_Type = 'Full';
  }),

  /** A transfer into an LP that already exists, rather than creating one. */
  transferToExistingLP: variant((m) => {
    m.transfers[0].Effective_Date = '2026-06-30';
    m.transfers[0].To_LP_ID = 'LP01';
  }),

  /** Transfer that moves only commitment, leaving paid-in and unfunded behind. */
  transferCommitmentOnly: variant((m) => {
    m.transfers[0].Effective_Date = '2026-06-30';
    m.transfers[0].Transfers_Paid_In = 'N';
    m.transfers[0].Transfers_UCC = 'N';
  }),

  /** Transferor is not in the register — should be skipped and reported. */
  transferFromUnknownLP: variant((m) => {
    m.transfers[0].Effective_Date = '2026-06-30';
    m.transfers[0].From_LP_ID = 'LP99';
  }),

  /** Nonsensical percentage — should be skipped, not silently clamped. */
  transferBadPct: variant((m) => {
    m.transfers[0].Effective_Date = '2026-06-30';
    m.transfers[0].Transfer_Pct = 1.4;
  }),

  /** Two LPs excused from a deal; the rest absorb their share. */
  excusedLPs: variant((m) => {
    m.components[0].Excused_LP_IDs = 'LP02, GP01';
  }),

  /** An LP excused from a component but not in the register. */
  excusedUnknownLP: variant((m) => {
    m.components[0].Excused_LP_IDs = 'LP99';
  }),

  /** Fee on NAV, which the register cannot support — falls back to Commitment. */
  feeBasisNAV: variant((m) => {
    m.fee.Fee_Basis = 'NAV';
  }),

  /** An unrecognised fee basis entirely. */
  feeBasisUnknown: variant((m) => {
    m.fee.Fee_Basis = 'Moon_Phase';
  }),

  /** Fee charged on invested capital rather than commitment. */
  feeBasisInvestedCapital: variant((m) => {
    m.fee.Fee_Basis = 'Invested_Capital';
  }),

  /** An unrecognised allocation basis on a component. */
  componentBasisUnknown: variant((m) => {
    m.components[0].Allocation_Basis = 'Vibes';
  }),

  /** Offsets larger than the gross fee, pushing the net fee negative. */
  offsetsExceedGross: variant((m) => {
    m.fee.offsets = [
      {
        Offset_ID: 'O1',
        Description: 'Oversized offset',
        Amount: 400000,
        Allocation_Method: 'Pro-rata to gross fee',
      },
    ];
  }),

  /** Offsets allocated by commitment and by invested capital rather than fee. */
  offsetsByOtherMethods: variant((m) => {
    m.fee.offsets = [
      { Offset_ID: 'O1', Description: 'By commitment', Amount: 30000, Allocation_Method: 'Commitment' },
      { Offset_ID: 'O2', Description: 'By invested capital', Amount: 20000, Allocation_Method: 'Invested_Capital' },
    ];
  }),

  /** The configured rounding plug is not in the register. */
  missingPlugLP: variant((m) => {
    m.setup.Rounding_Plug_LP_ID = 'LP99';
  }),

  /** Every participant has a zero basis, so nothing can be allocated. */
  zeroBasisComponent: variant((m) => {
    m.lps.forEach((l) => (l.Opening_Invested_Capital = 0));
    m.components[0].Allocation_Basis = 'Invested_Capital';
  }),

  /** The management fee called outside commitment. */
  feeOutsideCommitment: variant((m) => {
    m.fee.Reduces_Unfunded = 'N';
  }),

  /** Whole-dollar rounding instead of cents. */
  wholeDollarRounding: variant((m) => {
    m.setup.Rounding_Decimals = 0;
  }),

  /** Organizational expense above its cap. */
  orgExpenseOverCap: variant((m) => {
    m.setup.Org_Expense_Cap = 100000;
  }),

  /** A call that exceeds an LP's remaining unfunded commitment. */
  callExceedsUnfunded: variant((m) => {
    m.lps[1].Opening_UCC = 1000;
  }),

  /** Numbers arriving as Excel-formatted strings rather than numbers. */
  stringFormattedNumbers: variant((m) => {
    m.lps[0].Commitment = '10,000,000';
    m.lps[0].Opening_UCC = ' 8,000,000 ';
    m.components[0].Total_Amount = '$3,000,000';
  }),

  /** Dates as Excel serial numbers rather than ISO strings. */
  excelSerialDates: variant((m) => {
    m.setup.Call_Date = 46296; // 2026-09-30
    m.setup.Payment_Due_Date = 46310; // 2026-10-14
  }),

  /** No transfers, no offsets — the simplest possible call. */
  minimal: variant((m) => {
    m.transfers = [];
    m.fee.offsets = [];
  }),
};

/**
 * Capital call engine — public API.
 *
 * Pure calculation with no dependencies, no I/O and no framework. It runs
 * unchanged in a React client component, in a Next.js route handler and in
 * `node --test`, which is what makes the Expected_Output regression test
 * meaningful: the tested code is the shipped code.
 */

export { compute } from './compute';
export { emptyCall, type CallDefaults } from './empty-call';
export {
  BLANK_TERMS,
  SUGGESTED_TERMS,
  afterInvestmentPeriod,
  DEPENDS_ON,
  termApplies,
  withoutOrphans,
  applyFundTerms,
  changedTerms,
  draftTerms,
  paymentFor,
  paymentInstructions,
  scheduledAfter,
  termsOn,
  unsetTerms,
  type AppliedTerms,
  type FundTerms,
  type FeeTiming,
  type FeeDayCount,
  type InterestBasis,
  type CatchUpFeeTo,
  type EqualizationInterestTo,
} from './fund-terms';
export { allocate, type AllocationPart } from './allocate';
export {
  addBusinessDays,
  dayAfter,
  dayBefore,
  days360,
  daysBetween,
  daysIn,
  periodContaining,
  periodLabel,
  periodMonths,
  splitByPeriod,
} from './dates';
export { applyTransfers } from './transfers';
export { buildNotice } from './notice';
export {
  feeForRange,
  trueUp,
  type DatedAmount,
  type FeeInvestor,
  type FeeLine,
  type FeeResult,
  type FeeSlice,
  type TrueUpLine,
} from './fee-run';
export {
  equalize,
  equalizationRunTo,
  interestOnCalls,
  type CallShare,
  type EqualizationCheck,
  type EqualizationInput,
  type EqualizationLine,
  type EqualizationResult,
  type PriorCall,
} from './equalization';
export { splitCall, type CallSplit } from './summary';
export {
  fundRegister,
  positionFromRecord,
  registerDifferences,
  registerMismatches,
  type FundRegister,
  type RegisterDifference,
} from './fund-register';
export { CATEGORIES, categoryOf, isDeal, type Category } from './categories';
export { callFeePeriod, feeAlreadyCharged, feeFraction, type CallFeePeriod } from './call-fee';
export {
  buildFeeSchedule,
  catchUpFeesFor,
  defaultFeePeriods,
  feeOwed,
  feeScheduleDifferences,
  scheduleLabel,
  feeLedgerFor,
  termsEditImpact,
  type CatchUpFee,
  type FeeLedgerEntry,
  type PeriodOwed,
  type TermsEditImpact,
} from './fee-billing';
export { capitalAccount, type AccountEntry, type CapitalAccount } from './capital-account';
export {
  commitmentsFrom,
  catchUpFeeThrough,
  equalizationInputFor,
  feeInvestorsFrom,
  feePeriodsFor,
  feeRunFor,
  firstClosing,
  positionsOn,
  type ClosingRecord,
  type Settlement,
  type FeePeriod,
  type FundHistory,
} from './fund-history';
export {
  issuedCallFrom,
  positionsAsOf,
  type FinalisedEqualization,
  type IssuedCall,
  type IssuedCallLine,
  type Position,
} from './positions';
export type { NoticeData, NoticeLine, NoticeAccountLine, NoticeFootnote } from './notice';
export { fmt, fmtDate, fmtStamp, ids, num, pct, round, serialToISO, yes } from './format';
export type * from './types';
export {
  amountDue,
  buildEqualizationSchedule,
  equalizationOwed,
  equalizationNetOf,
  equalizationPartsOf,
  equalizationForStatement,
  settlementConflict,
  interestRunsToDueDate,
  suggestedStatementDueDate,
  STATEMENT_DAYS_TO_PAY,
  equalizationScheduleDifferences,
  unsettledClosings,
  type ClosingOwed,
} from './equalization-billing';

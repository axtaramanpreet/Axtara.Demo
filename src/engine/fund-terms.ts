/**
 * A fund's terms, as they stood on a given date.
 *
 * A fund's settings are a dated history, not a single record: a new row from
 * the date a term changes, never an edit. That is what lets anything later —
 * a fee true-up, an equalization — ask "what were the terms on 15 March?" and
 * get the answer that applied then rather than the one that applies now.
 *
 * Blank means "not set". Nothing here invents a value for a blank term; the
 * caller decides what a blank means where it is used, and the Settings screen
 * says which terms are still blank, so a default is never mistaken for a term
 * somebody read out of the fund's agreement.
 */

import { dayAfter } from './dates';
import type { Cell, CallModel, FeeConfig, FundSetup } from './types';

export type FeeTiming = 'advance' | 'arrears';
export type FeeDayCount = 'period_fraction' | 'actual_365' | 'actual_360' | '30_360';
export type InterestBasis = 'simple' | 'compound';
export type CatchUpFeeTo = 'gp' | 'existing_lps';
export type EqualizationInterestTo = 'existing_lps' | 'fund' | 'gp';
/** Where equalization interest on capital stops: the closing, or when the late investor actually pays. */
export type EqualizationInterestUntil = 'closing_date' | 'collection_due_date';
/** Interest on the catch-up management fee, and from when. */
export type CatchUpFeeInterest = 'none' | 'first_close' | 'per_period';
/**
 * What a later closing's catch-up fee covers: the fee periods already billed to
 * the investors in before it (later periods bill the late investor in full, like
 * everyone else), or every day up to the closing.
 */
export type CatchUpFeeUntil = 'billed_periods' | 'closing_date';

export interface FundTerms {
  /** YYYY-MM-DD. These terms apply from this date until a later row. */
  effectiveFrom: string;
  /** When the row was entered. Breaks a tie between two rows for one date. */
  createdAt: string;

  reportingCurrency: string | null;
  roundingDecimals: number | null;
  roundingPlugLpId: string | null;

  feeBasis: string | null;
  feeRateAnnual: number | null;
  feePeriodFraction: number | null;
  feeReducesUnfunded: boolean | null;
  feeExemptLpIds: string[];
  orgExpenseCap: number | null;

  gpName: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;

  investmentPeriodEnd: string | null;
  fundTermEnd: string | null;

  feeTiming: FeeTiming | null;
  feeDayCount: FeeDayCount | null;
  lateCloseInterestRate: number | null;
  lateCloseInterestBasis: InterestBasis | null;
  catchUpFeeTo: CatchUpFeeTo | null;
  equalizationInterestTo: EqualizationInterestTo | null;
  /** Blank: to the due date of the call or statement that collects it. */
  equalizationInterestUntil: EqualizationInterestUntil | null;
  /** Blank: on the whole catch-up fee, from the first closing to the late investor's closing. */
  catchUpFeeInterest: CatchUpFeeInterest | null;
  /** A year, for interest on the catch-up fee. Blank: the late-close interest rate. */
  catchUpFeeInterestRate: number | null;
  /** Blank: the fee periods already billed to the others. */
  catchUpFeeUntil: CatchUpFeeUntil | null;

  /** Where investors wire money: printed on every notice and statement. */
  paymentBankName: string | null;
  paymentAccountName: string | null;
  paymentAccountNo: string | null;
  paymentSwift: string | null;
  /** ABA, sort code, IFSC or IBAN — whatever the bank's country uses. */
  paymentRouting: string | null;
  /** What to quote on the wire. {LP_ID} and {CALL_NO} are filled in per notice; a statement fills {CALL_NO} with EQ and the closing number. */
  paymentReference: string | null;

  note: string | null;
}

/** Every term blank. The starting point for a fund's first set of terms. */
export const BLANK_TERMS: FundTerms = {
  effectiveFrom: '',
  createdAt: '',
  reportingCurrency: null,
  roundingDecimals: null,
  roundingPlugLpId: null,
  feeBasis: null,
  feeRateAnnual: null,
  feePeriodFraction: null,
  feeReducesUnfunded: null,
  feeExemptLpIds: [],
  orgExpenseCap: null,
  gpName: null,
  signatoryName: null,
  signatoryTitle: null,
  investmentPeriodEnd: null,
  fundTermEnd: null,
  feeTiming: null,
  feeDayCount: null,
  lateCloseInterestRate: null,
  lateCloseInterestBasis: null,
  catchUpFeeTo: null,
  equalizationInterestTo: null,
  equalizationInterestUntil: null,
  catchUpFeeInterest: null,
  catchUpFeeInterestRate: null,
  catchUpFeeUntil: null,
  paymentBankName: null,
  paymentAccountName: null,
  paymentAccountNo: null,
  paymentSwift: null,
  paymentRouting: null,
  paymentReference: null,
  note: null,
};

/**
 * Fields that record the row rather than say anything about the fund. (The
 * exempt list is a setting, but an empty list is an answer — nobody exempt —
 * so it is never "unset" and never shows up below.)
 */
const BOOKKEEPING = new Set<keyof FundTerms>(['effectiveFrom', 'createdAt', 'note']);

/**
 * The terms in force on `date`: the latest row on or before it, and of rows
 * sharing that date, the one entered last — a correction beats the row it
 * corrects. Null before the fund's first row.
 */
export function termsOn(history: FundTerms[], date: string): FundTerms | null {
  let best: FundTerms | null = null;
  for (const row of history) {
    if (row.effectiveFrom > date) continue;
    if (
      !best ||
      row.effectiveFrom > best.effectiveFrom ||
      (row.effectiveFrom === best.effectiveFrom && row.createdAt > best.createdAt)
    ) {
      best = row;
    }
  }
  return best;
}

/** The settings still blank in these terms, for the screen to flag. */
export function unsetTerms(terms: FundTerms): (keyof FundTerms)[] {
  // A term that does not apply (no fee, so no fee basis) is not "unset".
  return (Object.keys(terms) as (keyof FundTerms)[]).filter(
    (key) => !BOOKKEEPING.has(key) && terms[key] === null && termApplies(terms, key),
  );
}

/**
 * Terms that only mean something once another is set: how a fee is charged
 * means nothing without a fee, and who receives late-close interest means
 * nothing without the interest. A rate of zero counts as none.
 */
export const DEPENDS_ON: Partial<Record<keyof FundTerms, keyof FundTerms>> = {
  feeBasis: 'feeRateAnnual',
  feePeriodFraction: 'feeRateAnnual',
  feeTiming: 'feeRateAnnual',
  feeDayCount: 'feeRateAnnual',
  feeReducesUnfunded: 'feeRateAnnual',
  catchUpFeeTo: 'feeRateAnnual',
  catchUpFeeUntil: 'feeRateAnnual',
  lateCloseInterestBasis: 'lateCloseInterestRate',
  equalizationInterestTo: 'lateCloseInterestRate',
  equalizationInterestUntil: 'lateCloseInterestRate',
  // Interest on the catch-up fee can have its own rate, so it needs only a fee.
  catchUpFeeInterest: 'feeRateAnnual',
  catchUpFeeInterestRate: 'feeRateAnnual',
};

/** Whether a term applies, given the terms it depends on. */
export function termApplies(terms: Pick<FundTerms, 'feeRateAnnual' | 'lateCloseInterestRate'>, key: keyof FundTerms): boolean {
  const parent = DEPENDS_ON[key];
  if (!parent) return true;
  const value = (terms as Record<string, unknown>)[parent];
  return value !== null && value !== undefined && value !== 0;
}

/** The terms with every term that does not apply cleared, so nothing is stored that means nothing. */
export function withoutOrphans<T extends Omit<FundTerms, 'createdAt'>>(terms: T): T {
  const out = { ...terms };
  for (const key of Object.keys(DEPENDS_ON) as (keyof FundTerms)[]) {
    if (!termApplies(terms, key)) (out as Record<string, unknown>)[key] = null;
  }
  return out;
}

/** Where a term lands in a call. Some land twice: the fee rate is both the
 * Fund_Setup default and the Management_Fee value, and the two must agree. */
type Cellref = { step: 'setup'; key: keyof FundSetup } | { step: 'fee'; key: keyof FeeConfig };

const TERM_FIELDS: { term: keyof FundTerms; cells: Cellref[]; toCell?: (v: never) => Cell }[] = [
  { term: 'reportingCurrency', cells: [{ step: 'setup', key: 'Reporting_Currency' }] },
  { term: 'roundingDecimals', cells: [{ step: 'setup', key: 'Rounding_Decimals' }] },
  { term: 'orgExpenseCap', cells: [{ step: 'setup', key: 'Org_Expense_Cap' }] },
  { term: 'gpName', cells: [{ step: 'setup', key: 'GP_Name' }] },
  { term: 'signatoryName', cells: [{ step: 'setup', key: 'Signatory_Name' }] },
  { term: 'signatoryTitle', cells: [{ step: 'setup', key: 'Signatory_Title' }] },
  {
    term: 'feeBasis',
    cells: [
      { step: 'setup', key: 'Default_Mgmt_Fee_Basis' },
      { step: 'fee', key: 'Fee_Basis' },
    ],
  },
  {
    term: 'feeRateAnnual',
    cells: [
      { step: 'setup', key: 'Default_Mgmt_Fee_Rate_Annual' },
      { step: 'fee', key: 'Default_Fee_Rate_Annual' },
    ],
  },
  {
    term: 'feePeriodFraction',
    cells: [
      { step: 'setup', key: 'Mgmt_Fee_Period_Fraction' },
      { step: 'fee', key: 'Fee_Period_Fraction' },
    ],
  },
  { term: 'feeReducesUnfunded', cells: [{ step: 'fee', key: 'Reduces_Unfunded' }], toCell: ((v: boolean) => (v ? 'Y' : 'N')) as (v: never) => Cell },
  { term: 'feeExemptLpIds', cells: [{ step: 'fee', key: 'Fee_Exempt_LP_IDs' }], toCell: ((v: string[]) => v.join(', ')) as (v: never) => Cell },
];

/** A term counts as set when it has a value. An empty exempt list is "nobody
 * recorded", not "nobody exempt", so it does not lock a call's own list. */
const isSet = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

export interface AppliedTerms {
  model: CallModel;
  /** "setup.GP_Name", "fee.Fee_Basis"…: cells that now come from Settings. */
  locked: Set<string>;
  /** Cells whose value the terms replaced, for saying so. */
  changed: { step: 'setup' | 'fee'; key: string; was: Cell; now: Cell }[];
}

/**
 * Put a fund's terms into a call.
 *
 * Once a fund has terms, they decide every fund-level cell of a call — the
 * currency, rounding, the fee and who signs — and every one of those cells is
 * locked. A term left blank in Fund terms is blank on the call: a workbook
 * cannot fill it in, and nor can typing on the call. That is what keeps every
 * call of a fund on the same terms. A fund with no terms recorded (`terms`
 * null) is left exactly as it was.
 *
 * The rounding plug is not locked: it is picked per call. With `prefillPlug`
 * (a brand-new call) the fund's usual plug fills it if the call has none.
 */
export function applyFundTerms(
  model: CallModel,
  terms: FundTerms | null,
  options: { prefillPlug?: boolean } = {},
): AppliedTerms {
  const next: CallModel = { ...model, setup: { ...model.setup }, fee: { ...model.fee } };
  const locked = new Set<string>();
  const changed: AppliedTerms['changed'] = [];
  if (!terms) return { model: next, locked, changed };

  // Every fund-level cell follows the terms — a term left blank there is blank
  // here too — so a call cannot carry a fee, a signatory or a rounding rule the
  // fund never recorded, from a workbook or from typing.
  for (const field of TERM_FIELDS) {
    const value = terms[field.term];
    const cell = !isSet(value) ? '' : field.toCell ? field.toCell(value as never) : (value as Cell);
    for (const ref of field.cells) {
      const target = (ref.step === 'setup' ? next.setup : next.fee) as unknown as Record<string, Cell>;
      const key = String(ref.key);
      const was = target[key];
      if (String(was ?? '') !== String(cell ?? '')) changed.push({ step: ref.step, key, was, now: cell });
      target[key] = cell;
      locked.add(`${ref.step}.${key}`);
    }
  }

  if (options.prefillPlug && terms.roundingPlugLpId && !String(next.setup.Rounding_Plug_LP_ID ?? '').trim()) {
    next.setup.Rounding_Plug_LP_ID = terms.roundingPlugLpId;
  }

  return { model: next, locked, changed };
}

/**
 * The terms that differ between two rows, for the history list: "fee rate,
 * fee basis" says what a change was without anyone reading every field.
 * Against no previous row, every term that is set counts as a change.
 */
export function changedTerms(before: FundTerms | null, after: FundTerms): (keyof FundTerms)[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return (Object.keys(after) as (keyof FundTerms)[]).filter((key) => {
    if (BOOKKEEPING.has(key)) return false;
    const was = before ? before[key] : BLANK_TERMS[key];
    return !same(was, after[key]);
  });
}

/**
 * What the form offers for a term nobody has set yet: the common choice, so a
 * new fund is not a page of blanks. A suggestion is only ever a starting value
 * in the form — nothing is stored until someone records it, and until then the
 * page still says "Not set". The fee rate is left out on purpose: there is no
 * common answer to suggest.
 */
export const SUGGESTED_TERMS: Partial<FundTerms> = {
  reportingCurrency: 'USD',
  roundingDecimals: 2,
  feeBasis: 'Commitment',
  feePeriodFraction: 0.25,
  feeReducesUnfunded: true,
  feeTiming: 'advance',
  feeDayCount: 'period_fraction',
  lateCloseInterestBasis: 'simple',
  catchUpFeeTo: 'gp',
  equalizationInterestTo: 'existing_lps',
  equalizationInterestUntil: 'collection_due_date',
  catchUpFeeInterest: 'first_close',
  catchUpFeeUntil: 'billed_periods',
};

/**
 * The terms to start the form from: what is in force, with the suggestion
 * standing in wherever nothing is — and which ones those were, so the form can
 * say "suggested, check against the LPA" beside them.
 */
export function draftTerms(inForce: FundTerms | null): {
  terms: FundTerms;
  suggested: (keyof FundTerms)[];
} {
  const base = inForce ?? BLANK_TERMS;
  const terms: FundTerms = { ...base };
  const suggested: (keyof FundTerms)[] = [];
  for (const [key, value] of Object.entries(SUGGESTED_TERMS) as [keyof FundTerms, never][]) {
    if (base[key] === null) {
      (terms as unknown as Record<string, unknown>)[key] = value;
      suggested.push(key);
    }
  }
  return { terms, suggested };
}

/**
 * The fee once the investment period is over, as its own dated row.
 *
 * Many LPAs move the fee from commitments to invested capital, cut the rate,
 * or both, when the investment period ends. That is not a second kind of
 * setting: it is the same terms with a different basis and rate, from the day
 * after the period ends — so it is recorded exactly like any other change, and
 * `termsOn` picks it up on and after that date.
 */
export function afterInvestmentPeriod(
  terms: Omit<FundTerms, 'createdAt'>,
  change: { feeBasis: string | null; feeRateAnnual: number | null },
): Omit<FundTerms, 'createdAt'> {
  if (!terms.investmentPeriodEnd) {
    throw new Error('Set when the investment period ends before scheduling the fee after it.');
  }
  return {
    ...terms,
    effectiveFrom: dayAfter(terms.investmentPeriodEnd),
    feeBasis: change.feeBasis,
    feeRateAnnual: change.feeRateAnnual,
    note: 'Management fee after the investment period.',
  };
}

/** Rows that start after `date`: changes already recorded but not yet in force. */
export function scheduledAfter(history: FundTerms[], date: string): FundTerms[] {
  return history
    .filter((row) => row.effectiveFrom > date)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt));
}

/** Payment instructions as they print, with the reference filled in. Null until a bank and account are set. */
export function paymentInstructions(
  terms: FundTerms | null,
  fill: { lpId: string; callNo?: string | number },
): { label: string; value: string }[] | null {
  if (!terms?.paymentBankName || !terms.paymentAccountNo) return null;
  const reference = (terms.paymentReference ?? '{LP_ID}')
    .replaceAll('{LP_ID}', fill.lpId)
    .replaceAll('{CALL_NO}', fill.callNo === undefined ? '' : String(fill.callNo))
    .trim();
  return [
    { label: 'Bank', value: terms.paymentBankName },
    { label: 'Account name', value: terms.paymentAccountName ?? '' },
    { label: 'Account number', value: terms.paymentAccountNo },
    { label: 'SWIFT / BIC', value: terms.paymentSwift ?? '' },
    { label: 'Routing', value: terms.paymentRouting ?? '' },
    { label: 'Reference', value: reference },
  ].filter((l) => l.value);
}

/** The payment instructions for one investor on one call: the fund's terms in force on the call date. */
export function paymentFor(
  history: FundTerms[],
  callDate: string,
  lpId: string,
  callNo: string | number,
): { label: string; value: string }[] | null {
  return paymentInstructions(termsOn(history, callDate || '9999-12-31'), { lpId, callNo });
}

/** Where equalization interest on capital stops, for these terms: blank is the collecting document's due date. */
export function interestUntilOf(terms: Pick<FundTerms, 'equalizationInterestUntil'> | null): EqualizationInterestUntil {
  return terms?.equalizationInterestUntil ?? 'collection_due_date';
}

/** Interest on the catch-up fee, for these terms: blank is the whole fee from the first closing. */
export function catchUpFeeInterestOf(terms: Pick<FundTerms, 'catchUpFeeInterest'> | null): CatchUpFeeInterest {
  return terms?.catchUpFeeInterest ?? 'first_close';
}

/** What the catch-up fee covers, for these terms: blank is the fee periods already billed to the others. */
export function catchUpFeeUntilOf(terms: Pick<FundTerms, 'catchUpFeeUntil'> | null): CatchUpFeeUntil {
  return terms?.catchUpFeeUntil ?? 'billed_periods';
}

/** The rate a year for interest on the catch-up fee: its own, or blank for the late-close rate. Null: none. */
export function catchUpFeeInterestRateOf(terms: Pick<FundTerms, 'catchUpFeeInterestRate' | 'lateCloseInterestRate'> | null): number | null {
  return terms?.catchUpFeeInterestRate ?? terms?.lateCloseInterestRate ?? null;
}

/**
 * What a fund may do next, from how far it has got.
 *
 * A fund is set up in order: its terms, then its first close, then calls and
 * fees. Each step reads the one before — a closing's fees and equalization read
 * the terms, a call's register reads the closings — so a later step is not
 * offered until the earlier one is done.
 *
 * Funds that were already running before this order existed keep working: one
 * with calls may go on calling, and one with closings may go on closing,
 * whether or not the earlier steps were ever recorded.
 */

export interface FundProgress {
  hasTerms: boolean;
  /** Investors on the register. Not a gate: a closing can add them itself. */
  investors: number;
  closings: number;
  finalisedClosings: number;
  calls: number;
}

export interface FundGates {
  /** Why closings are not open yet, or null when they are. */
  closings: string | null;
  /** Why a new call cannot be started yet, or null when it can. */
  calls: string | null;
  /** Why fees are not open yet, or null when they are. */
  fees: string | null;
}

export const NO_GATES: FundGates = { closings: null, calls: null, fees: null };

export function fundGates(p: FundProgress): FundGates {
  const closings = p.hasTerms || p.closings > 0 || p.calls > 0 ? null : 'Record the fund’s terms first: a closing’s fees and equalization are worked out from them.';
  const needClose = closings ?? 'Finalise the first close first: it says who the fund’s investors are.';
  const calls = p.finalisedClosings > 0 || p.calls > 0 ? null : needClose;
  const fees = p.finalisedClosings > 0 || p.calls > 0 ? null : needClose;
  return { closings, calls, fees };
}

export interface NextStep {
  /** What was just done, in words. */
  done: string;
  label: string;
  /** Path under the fund, e.g. "investors". Empty for the fund's home. */
  path: string;
}

/**
 * While a fund is being set up, the step after the one this page is for — so
 * finishing a step never leaves someone wondering where to go. Null once the
 * fund is running, or when this page's step is not done yet.
 */
export function nextStep(p: FundProgress, page: 'settings' | 'investors' | 'closings'): NextStep | null {
  if (p.calls > 0) return null;
  if (page === 'settings' && p.hasTerms) {
    return p.investors ? null : { done: 'The fund’s terms are recorded.', label: 'Next: add the investors', path: 'investors' };
  }
  if (page === 'investors' && p.investors > 0 && p.closings === 0) {
    return { done: `${p.investors} investor${p.investors === 1 ? '' : 's'} on the register.`, label: 'Next: record the first close', path: 'closings' };
  }
  if (page === 'closings' && p.finalisedClosings > 0) {
    return { done: 'The first close is finalised.', label: 'Next: issue the first call', path: '' };
  }
  return null;
}

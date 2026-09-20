/**
 * Whether a call has enough in it to be worth calculating.
 *
 * `compute()` will run on almost anything — a call with no investors allocates
 * nothing to nobody and reports it as zero, which looks like an answer. This is
 * the gate in front of that: the handful of inputs without which "Review
 * allocation" produces a page of blanks rather than a mistake worth seeing.
 *
 * Deliberately not the same thing as the tie-out checks. Those judge a call
 * that has been calculated; these say whether calculating is meaningful yet.
 * Anything arguable — a component that ties oddly, an offset larger than the
 * fee — belongs in the checks, where a person can look at it. Only what makes
 * the output empty belongs here.
 */

import { num } from './format';
import type { CallModel } from './types';

export interface Missing {
  /** The step in the stepper that fixes it. */
  step: 'setup' | 'lps' | 'components';
  /** What is missing, as a person would say it. */
  what: string;
}

export function missingForReview(model: CallModel): Missing[] {
  const missing: Missing[] = [];
  const setup = model.setup;

  // The notice is headed by the fund and dated twice. Without these it is a
  // letter asking for money from nobody, on no date, payable never.
  if (!String(setup.Fund_Name ?? '').trim()) {
    missing.push({ step: 'setup', what: 'the fund’s name' });
  }
  if (!String(setup.Call_Date ?? '').trim()) {
    missing.push({ step: 'setup', what: 'a notice date' });
  }
  if (!String(setup.Payment_Due_Date ?? '').trim()) {
    missing.push({ step: 'setup', what: 'a payment due date' });
  }

  // Transferred LPs are on the register but do not participate, so an active
  // one with a commitment is the real requirement.
  const participating = model.lps.filter(
    (lp) => String(lp.Status ?? '').trim().toLowerCase() !== 'transferred' && num(lp.Commitment) > 0,
  );
  if (!participating.length) {
    missing.push({
      step: 'lps',
      what: model.lps.length
        ? 'an investor with a commitment — every row on the register is transferred or has none'
        : 'at least one investor on the register',
    });
  }

  // Something to actually call. A management fee on its own is a real call, so
  // components are not required as long as the fee will produce an amount.
  const componentTotal = model.components.reduce((t, c) => t + num(c.Total_Amount), 0);
  const feeWillCharge =
    num(model.fee.Default_Fee_Rate_Annual) > 0 && num(model.fee.Fee_Period_Fraction) > 0;
  if (componentTotal <= 0 && !feeWillCharge) {
    missing.push({ step: 'components', what: 'an amount to call — no components and no fee' });
  }

  return missing;
}

/** One sentence for a tooltip, or null when there is nothing to say. */
export function whyNotReady(missing: Missing[]): string | null {
  if (!missing.length) return null;
  const list = missing.map((m) => m.what);
  const last = list.pop() as string;
  return `Still needed: ${list.length ? `${list.join(', ')} and ${last}` : last}.`;
}

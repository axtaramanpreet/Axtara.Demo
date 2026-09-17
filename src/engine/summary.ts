/**
 * How a call divides up, for the places that present it.
 *
 * Both the drawdown chart and the call summary need the same three-way split,
 * and it is fiddly enough to be worth stating once: the management fee sits
 * inside or outside the commitment depending on how the fund is configured, so
 * it cannot simply be subtracted from one side.
 */

import { round } from './format';
import type { ComputeResult } from './types';

export interface CallSplit {
  /** Components (and the fee, when it is drawn from commitment). */
  againstCommitment: number;
  /** Called on top of the commitment, reducing nothing. */
  outsideCommitment: number;
  /** Management fee after offsets. Shown separately wherever it appears. */
  feeNet: number;
  /** The total called. Equals the three lines above. */
  total: number;
}

/**
 * Split a computed call into what it draws against commitment, what it calls
 * outside it, and the net management fee.
 *
 * The fee is reported on its own line because an investor reading a notice
 * wants it separated from the deals — but it is already counted inside
 * `reduces` when the fund draws it from commitment, so it has to be taken back
 * out of that figure rather than added to it.
 */
export function splitCall(result: ComputeResult): CallSplit {
  const d = result.d;
  const feeNet = result.totals.feeNet;
  const feeInside = result.fee.reduces;

  return {
    againstCommitment: round(result.totals.reduces - (feeInside ? feeNet : 0), d),
    outsideCommitment: round(
      result.totals.total - result.totals.reduces - (feeInside ? 0 : feeNet),
      d,
    ),
    feeNet,
    total: result.totals.total,
  };
}

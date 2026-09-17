/**
 * Pro-rata allocation with a deterministic rounding plug.
 *
 * This is the single most important function in the engine: every component
 * and every fee offset is split across investors through it.
 */

import { round } from './format';
import type { AllocationResult } from './types';

/** One participant in an allocation, and the figure their share is measured against. */
export interface AllocationPart {
  id: string;
  /** Commitment, unfunded commitment or invested capital, depending on the basis. */
  basis: number;
}

/**
 * Split `total` across `parts` in proportion to each part's basis.
 *
 * Rounding each share independently almost always leaves a residual of a cent
 * or two against the total called. Rather than smear that across everyone
 * (which would be non-deterministic and impossible to reconcile), one LP — the
 * "plug" — absorbs it: everyone else gets their rounded share, and the plug gets
 * whatever is left. That makes the allocation tie to the called amount exactly,
 * every time, and always in the same place.
 *
 * The plug is `plugId` when that LP is participating, otherwise the largest
 * participant by basis, since a cent lands least visibly on the biggest ticket.
 *
 * @param total   Amount to allocate.
 * @param parts   Participating LPs and their basis figures.
 * @param plugId  Preferred LP to absorb the residual (Rounding_Plug_LP_ID).
 * @param d       Decimal places to round to.
 * @returns Amount per LP_ID, the LP that took the residual, and whether
 *          anything could be allocated at all.
 */
export function allocate(
  total: number,
  parts: AllocationPart[],
  plugId: string | undefined,
  d: number,
): AllocationResult {
  const out: Record<string, number> = {};
  const sumB = parts.reduce((s, p) => s + p.basis, 0);

  // Nobody to allocate to, or every participant has a zero basis. Allocating
  // would mean dividing by zero, so return zeros and let the caller raise it
  // as a failing check rather than silently producing NaN.
  if (!parts.length || sumB <= 0) {
    parts.forEach((p) => (out[p.id] = 0));
    return { out, plugId: null, ok: false };
  }

  // Everyone's rounded pro-rata share.
  parts.forEach((p) => (out[p.id] = round((total * p.basis) / sumB, d)));

  // Pick the plug: the configured LP if they're participating, else the largest
  // by basis. `>` rather than `>=` keeps ties on the earliest row, so the choice
  // is stable across runs.
  const plug =
    parts.find((p) => p.id === plugId) ??
    parts.reduce((a, b) => (b.basis > a.basis ? b : a));

  // Give the plug the remainder instead of its own rounded share, so the
  // allocation sums to `total` to the cent.
  const others = parts
    .filter((p) => p.id !== plug.id)
    .reduce((s, p) => s + out[p.id], 0);
  out[plug.id] = round(total - others, d);

  return { out, plugId: plug.id, ok: true };
}

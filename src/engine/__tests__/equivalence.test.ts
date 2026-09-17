/**
 * Differential test: the readable port vs. the original handoff engine.
 *
 * `design_handoff_capital_call_engine 2/engine.js` is the delivered spec for the
 * calculation, but it is written as dense one-liners — a single 300-character
 * return statement for the per-LP roll-up. Rewriting that for readability means
 * touching code that decides what investors are asked to wire, so "it still
 * passes the golden fixture" is not a strong enough guarantee: the fixture only
 * covers the happy path.
 *
 * This runs both engines over every scenario and asserts the outputs are
 * identical — same numbers, same checks, in the same order. It is what makes the
 * rewrite safe rather than hopeful.
 *
 * The handoff directory is a read-only reference kept for exactly this purpose.
 * Once the port has been reviewed and signed off, this file and the handoff
 * reference can be retired together.
 */

import { describe, expect, it } from 'vitest';
import {
  compute as computeOriginal,
  buildNotice as buildNoticeOriginal,
} from '../../../design_handoff_capital_call_engine 2/engine.js';
import { buildNotice, compute } from '@/engine';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import type { CallModel } from '@/engine/types';

describe('ported engine matches the original handoff implementation', () => {
  for (const [name, model] of Object.entries(SCENARIOS)) {
    describe(name, () => {
      // Each engine gets its own copy: `applyTransfers` mutates its roster, and
      // sharing input would let the first run contaminate the second.
      const ported = compute(structuredClone(model) as CallModel);
      const original = computeOriginal(structuredClone(model));

      it('produces identical per-investor rows', () => {
        expect(ported.rows).toEqual(original.rows);
      });

      it('produces identical fund totals', () => {
        expect(ported.totals).toEqual(original.totals);
      });

      it('produces identical checks, in the same order', () => {
        expect(ported.checks).toEqual(original.checks);
      });

      it('produces identical Expected_Output diffs', () => {
        expect(ported.goldenDiffs).toEqual(original.goldenDiffs);
      });

      it('produces an identical roster and transfer outcome', () => {
        expect(ported.roster).toEqual(original.roster);
        expect(ported.transfers).toEqual(original.transfers);
      });

      it('produces an identical fee summary', () => {
        expect(ported.fee).toEqual(original.fee);
      });

      it('produces identical notices for every investor', () => {
        ported.rows.forEach((row, i) => {
          expect(buildNotice(model, ported, row)).toEqual(
            buildNoticeOriginal(model, original, original.rows[i]),
          );
        });
      });
    });
  }
});

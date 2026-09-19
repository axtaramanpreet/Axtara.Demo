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
import type { NoticeData } from '@/engine';

/**
 * Scenarios where this engine deliberately differs from the original, with the
 * divergence asserted separately below rather than waved through here.
 */
const DELIBERATE_DIVERGENCE = new Set(['wholeDollarRounding']);

/**
 * A notice with the letter wording removed.
 *
 * The prose is the fund's own template and is not something the handoff engine
 * produces, so comparing it would only ever report the difference that was
 * asked for. Everything an investor acts on — the amounts, the account summary,
 * the footnotes — still has to match to the character.
 */
const WORDING = ['gp', 'salutation', 'subject', 'intro', 'closing', 'signOff'] as const;

function figuresOf(notice: NoticeData | Record<string, unknown>) {
  const rest = { ...(notice as Record<string, unknown>) };
  for (const key of WORDING) delete rest[key];
  return rest;
}

describe('ported engine matches the original handoff implementation', () => {
  for (const [name, model] of Object.entries(SCENARIOS)) {
    if (DELIBERATE_DIVERGENCE.has(name)) continue;
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

      it('produces identical notice figures for every investor', () => {
        // The letter wording diverges on purpose — see below — so this compares
        // everything the notice *states*: the amounts, the account summary and
        // the generated footnotes.
        ported.rows.forEach((row, i) => {
          const mine = buildNotice(model, ported, row);
          const theirs = buildNoticeOriginal(model, original, original.rows[i]);
          expect(figuresOf(mine)).toEqual(figuresOf(theirs));
        });
      });
    });
  }
});

/**
 * The one deliberate departure from the handoff engine.
 *
 * It computed rounding decimals as `num(Rounding_Decimals) || 2`, so a fund
 * that configured 0 — reporting in yen, or calling in whole units — silently
 * got two decimals instead. This engine honours the 0.
 *
 * Asserted rather than excluded, so the difference stays a decision on the
 * record instead of drift nobody notices.
 */
describe('deliberate divergence: a configured zero means zero', () => {
  const model = SCENARIOS.wholeDollarRounding;

  it('rounds to whole units where the original used cents', () => {
    const ported = compute(structuredClone(model) as CallModel);
    const original = computeOriginal(structuredClone(model));

    expect(ported.d).toBe(0);
    expect(original.d).toBe(2);

    expect(ported.rows.every((r) => Number.isInteger(r.total))).toBe(true);
    // The handoff module is untyped, hence the annotation.
    expect(original.rows.some((r: { total: number }) => !Number.isInteger(r.total))).toBe(true);
  });

  it('still ties: whole-unit allocations sum to the amount called', () => {
    // Without the Expected_Output rows, which state this fund in cents and so
    // rightly disagree with a call rounded to whole units. Every other check —
    // the component tie-outs and both roll-forwards — must still pass.
    const withoutFixture = structuredClone(model) as CallModel;
    withoutFixture.golden = null;

    const ported = compute(withoutFixture);
    expect(ported.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(ported.rows.every((r) => Number.isInteger(r.total))).toBe(true);
  });

  it('leaves a blank Rounding_Decimals on cents, as before', () => {
    const blank = structuredClone(model) as CallModel;
    blank.setup.Rounding_Decimals = '';
    expect(compute(blank).d).toBe(2);
    expect(computeOriginal(structuredClone(blank)).d).toBe(2);
  });
});

/**
 * The second deliberate departure from the handoff engine.
 *
 * Its notice carried a generic paragraph of its own composition. The wording is
 * the fund's to choose, and theirs names the general partner, cites the LPA and
 * says how and by when to pay — so the engine now carries their template and
 * both the screen and the PDF render it from one place.
 *
 * Asserted rather than excluded, so the difference stays a decision on the
 * record instead of drift nobody notices.
 */
describe('deliberate divergence: the fund supplies the letter', () => {
  const model = structuredClone(SCENARIOS.base) as CallModel;
  model.setup.GP_Name = 'Meridian Growth GP III LLC';

  const result = compute(model);
  const notice = buildNotice(model, result, result.rows[0]);

  it('names the general partner where the fund has given one', () => {
    expect(notice.gp).toBe('Meridian Growth GP III LLC');
    expect(notice.intro[0]).toContain('on behalf of Meridian Growth GP III LLC');
    expect(notice.intro[0]).toContain('Limited Partnership Agreement');
  });

  it('falls back to the role rather than leaving a gap', () => {
    const anonymous = structuredClone(SCENARIOS.base) as CallModel;
    anonymous.setup.GP_Name = '';
    const built = compute(anonymous);
    const plain = buildNotice(anonymous, built, built.rows[0]);

    expect(plain.gp).toBe('the General Partner');
    expect(plain.intro[0]).toContain('on behalf of the General Partner');
    expect(plain.intro[0]).not.toContain('undefined');
  });

  it('addresses the investor by name', () => {
    expect(notice.salutation).toBe(`Dear ${result.rows[0].LP_Name},`);
  });

  it('says by when to pay, and does not claim instructions it has not got', () => {
    const text = notice.closing.join(' ');
    expect(text).toContain(notice.dueDate);

    // The fund's template directed the investor to "the wiring instructions
    // provided with this notice". None are provided, so the sentence was
    // removed rather than left saying something untrue in the paragraph that
    // asks somebody to move money. This fails if it comes back before the
    // bank details do.
    expect(text).not.toContain('wiring instructions');
  });

  it('is wording the handoff engine never produced', () => {
    const theirResult = computeOriginal(structuredClone(model));
    const theirs = buildNoticeOriginal(model, theirResult, theirResult.rows[0]) as Record<
      string,
      unknown
    >;

    // The handoff notice carries no letter at all; that absence is the
    // divergence, and it is why figuresOf() drops these before comparing.
    for (const key of WORDING) {
      expect(theirs[key], `handoff notice unexpectedly has ${key}`).toBeUndefined();
    }
  });
});

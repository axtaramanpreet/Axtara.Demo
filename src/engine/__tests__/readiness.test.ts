/**
 * The gate in front of "Review allocation".
 *
 * `compute()` runs on almost anything, so a call with no investors produces a
 * page of zeros that reads like an answer. These pin what has to be there
 * before calculating means something — and, just as much, what must NOT block
 * it, because a gate that refuses a valid call is worse than no gate.
 */

import { describe, expect, it } from 'vitest';
import { ILLUSTRATIVE_FUND } from '../fixtures/illustrative-fund';
import { missingForReview, whyNotReady } from '../readiness';
import type { CallModel } from '../types';

const complete = ILLUSTRATIVE_FUND as CallModel;
const without = (patch: Partial<CallModel>): CallModel => ({ ...complete, ...patch });

describe('a call that is ready', () => {
  it('is not held up at all', () => {
    expect(missingForReview(complete)).toEqual([]);
    expect(whyNotReady(missingForReview(complete))).toBeNull();
  });
});

describe('what has to be there first', () => {
  it('the fund’s name, since the notice is headed by it', () => {
    const m = missingForReview(without({ setup: { ...complete.setup, Fund_Name: '  ' } }));
    expect(m).toEqual([{ step: 'setup', what: 'the fund’s name' }]);
  });

  it('both dates, since the notice states when to pay', () => {
    const m = missingForReview(
      without({ setup: { ...complete.setup, Call_Date: '', Payment_Due_Date: '' } }),
    );
    expect(m.map((x) => x.what)).toEqual(['a notice date', 'a payment due date']);
  });

  it('somebody to call it from', () => {
    const m = missingForReview(without({ lps: [] }));
    expect(m).toEqual([{ step: 'lps', what: 'at least one investor on the register' }]);
  });

  it('and they have to actually participate', () => {
    // A register of transferred LPs is not a register.
    const gone = complete.lps.map((lp) => ({ ...lp, Status: 'Transferred' }));
    expect(missingForReview(without({ lps: gone }))[0].what).toContain('every row on the register');
  });

  it('and they have to have committed something', () => {
    const broke = complete.lps.map((lp) => ({ ...lp, Commitment: '' }));
    expect(missingForReview(without({ lps: broke }))[0].step).toBe('lps');
  });

  it('something to call', () => {
    const m = missingForReview(
      without({
        components: [],
        fee: { ...complete.fee, Default_Fee_Rate_Annual: 0 },
      }),
    );
    expect(m).toEqual([
      { step: 'components', what: 'an amount to call — no components and no fee' },
    ]);
  });
});

describe('what must not block it', () => {
  it('a fee-only call, which is a real capital call', () => {
    // Quarterly management fee with no deals in it.
    expect(missingForReview(without({ components: [] }))).toEqual([]);
  });

  it('a components-only call, with the fee switched off', () => {
    const m = missingForReview(
      without({ fee: { ...complete.fee, Default_Fee_Rate_Annual: 0, Fee_Period_Fraction: 0 } }),
    );
    expect(m).toEqual([]);
  });

  it('a call whose figures are odd — that is what the checks are for', () => {
    // An offset bigger than the fee is worth flagging, not worth refusing to
    // calculate: a person has to see it to fix it.
    const m = missingForReview(
      without({ fee: { ...complete.fee, offsets: [{ Offset_ID: 'O1', Description: 'x', Amount: 9e9, Allocation_Method: 'Commitment' }] } }),
    );
    expect(m).toEqual([]);
  });
});

describe('what the button says when it will not go', () => {
  it('lists one thing plainly', () => {
    expect(whyNotReady([{ step: 'lps', what: 'an investor' }])).toBe('Still needed: an investor.');
  });

  it('joins several the way a person would', () => {
    expect(
      whyNotReady([
        { step: 'setup', what: 'a notice date' },
        { step: 'setup', what: 'a payment due date' },
        { step: 'lps', what: 'an investor' },
      ]),
    ).toBe('Still needed: a notice date, a payment due date and an investor.');
  });
});

/**
 * The three settings that decide how a call is allocated.
 *
 * Each is read from a specific place, with a specific fallback, and getting any
 * of them wrong changes what investors are asked to wire without anything
 * looking broken. These pin the behaviour rather than leaving it to be
 * rediscovered by reading the code.
 */

import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallModel } from '@/engine/types';

/** The fixture without its Expected_Output rows, which are stated in cents. */
function fund(mutate: (m: CallModel) => void): CallModel {
  const m = structuredClone(ILLUSTRATIVE_FUND);
  m.golden = null;
  mutate(m);
  return m;
}

describe('Rounding_Decimals — from Fund_Setup', () => {
  it('rounds every allocation to the configured precision', () => {
    expect(compute(fund(() => {})).rows[0].comps[0].amt).toBe(594059.41);
    expect(compute(fund((m) => (m.setup.Rounding_Decimals = 4))).rows[0].comps[0].amt).toBe(
      594059.4059,
    );
  });

  it('honours a configured zero', () => {
    // Regression: the handoff engine read this as `num(...) || 2`, so a fund
    // calling in whole units was silently given cents.
    const result = compute(fund((m) => (m.setup.Rounding_Decimals = 0)));
    expect(result.d).toBe(0);
    expect(result.rows.every((r) => Number.isInteger(r.total))).toBe(true);
  });

  it('honours a zero that arrives from Excel as text', () => {
    expect(compute(fund((m) => (m.setup.Rounding_Decimals = '0'))).d).toBe(0);
  });

  it('falls back to cents when it is not set', () => {
    expect(compute(fund((m) => (m.setup.Rounding_Decimals = ''))).d).toBe(2);
  });

  it('never goes negative', () => {
    expect(compute(fund((m) => (m.setup.Rounding_Decimals = -3))).d).toBe(0);
  });
});

describe('Rounding_Plug_LP_ID — who absorbs the residual', () => {
  /** An amount that cannot divide evenly, so there is a real residual to place. */
  const uneven = (plugId: string) =>
    compute(
      fund((m) => {
        m.setup.Rounding_Plug_LP_ID = plugId;
        m.components = [{ ...m.components[0], Total_Amount: 1000000.01 }];
      }),
    );

  it('gives the residual to the configured investor', () => {
    const plugged = uneven('LP04');
    expect(plugged.rows.find((r) => r.LP_ID === 'LP04')!.comps[0].amt).toBe(297029.72);
    // Everyone else keeps their own rounded share.
    expect(plugged.rows.find((r) => r.LP_ID === 'LP01')!.comps[0].amt).toBe(198019.8);
  });

  it('moves the residual when a different investor is nominated', () => {
    const plugged = uneven('LP01');
    expect(plugged.rows.find((r) => r.LP_ID === 'LP01')!.comps[0].amt).toBe(198019.81);
    expect(plugged.rows.find((r) => r.LP_ID === 'LP04')!.comps[0].amt).toBe(297029.71);
  });

  it('will use the smallest investor if that is who is named', () => {
    // Nothing forces the plug to be the largest; it is simply the default.
    expect(uneven('GP01').rows.find((r) => r.LP_ID === 'GP01')!.comps[0].amt).toBe(9901);
  });

  it('falls back to the largest participant, and says so, when unknown', () => {
    const plugged = uneven('LP99');
    // LP04 holds the largest commitment, so it takes the cent.
    expect(plugged.rows.find((r) => r.LP_ID === 'LP04')!.comps[0].amt).toBe(297029.72);
    expect(plugged.checks.some((c) => c.level === 'warn' && c.text.includes('LP99'))).toBe(true);
  });

  it('falls back to the largest participant when none is configured', () => {
    expect(uneven('').rows.find((r) => r.LP_ID === 'LP04')!.comps[0].amt).toBe(297029.72);
  });

  it('ties to the amount called however the plug is chosen', () => {
    for (const plugId of ['LP04', 'LP01', 'GP01', 'LP99', '']) {
      const total = uneven(plugId).rows.reduce((s, r) => s + r.comps[0].amt, 0);
      expect(total, `plug "${plugId}" does not tie`).toBeCloseTo(1000000.01, 2);
    }
  });
});

describe('fee basis — Commitment or Invested_Capital', () => {
  // LP01: 10,000,000 committed, 1,800,000 invested, 2% a year, quarter period.
  it('charges on committed capital', () => {
    const result = compute(fund((m) => (m.fee.Fee_Basis = 'Commitment')));
    expect(result.fee.basis).toBe('Commitment');
    expect(result.rows[0].feeGross).toBe(50000);
  });

  it('charges on invested capital', () => {
    const result = compute(fund((m) => (m.fee.Fee_Basis = 'Invested_Capital')));
    expect(result.fee.basis).toBe('Invested_Capital');
    expect(result.rows[0].feeGross).toBe(9000);
  });

  it('falls back to Fund_Setup when the fee tab leaves it blank', () => {
    const result = compute(
      fund((m) => {
        m.fee.Fee_Basis = '';
        m.setup.Default_Mgmt_Fee_Basis = 'Invested_Capital';
      }),
    );
    expect(result.fee.basis).toBe('Invested_Capital');
    expect(result.rows[0].feeGross).toBe(9000);
  });

  it('lets the fee tab override Fund_Setup', () => {
    const result = compute(
      fund((m) => {
        m.fee.Fee_Basis = 'Commitment';
        m.setup.Default_Mgmt_Fee_Basis = 'Invested_Capital';
      }),
    );
    expect(result.fee.basis).toBe('Commitment');
  });

  it('treats NAV as Commitment and warns, since the register carries no NAV', () => {
    const result = compute(fund((m) => (m.fee.Fee_Basis = 'NAV')));
    expect(result.fee.basis).toBe('Commitment');
    expect(result.checks.some((c) => c.level === 'warn' && c.text.includes('NAV'))).toBe(true);
  });

  it('rejects UCC as a fee basis, which is a component basis only', () => {
    const result = compute(fund((m) => (m.fee.Fee_Basis = 'UCC')));
    expect(result.fee.basis).toBe('Commitment');
    expect(result.checks.some((c) => c.level === 'warn' && c.text.includes('UCC'))).toBe(true);
  });

  it('warns rather than guessing at anything else', () => {
    const result = compute(fund((m) => (m.fee.Fee_Basis = 'Moon_Phase')));
    expect(result.fee.basis).toBe('Commitment');
    expect(result.checks.some((c) => c.level === 'warn' && c.text.includes('Moon_Phase'))).toBe(
      true,
    );
  });
});

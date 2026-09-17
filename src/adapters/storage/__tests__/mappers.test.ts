/**
 * Round-trip tests for the storage mapping layer.
 *
 * The failure mode being guarded against is silent: a fee flag stored as a
 * boolean and read back as the string `'true'` is not `'Y'`, so the engine's
 * `yes()` returns false and the management fee quietly stops reducing unfunded
 * commitment. Nothing throws; the numbers are just wrong.
 *
 * So rather than asserting field by field, these tests push the illustrative
 * fund out to database shape, read it back, and re-run the engine — the golden
 * fixture then has to still match the accountant's workbook to the cent.
 *
 * Verified against a live PostgREST instance: `numeric` columns come back as
 * JSON numbers, not strings, so the fixtures below use numbers.
 */

import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import type { CallModel } from '@/engine/types';
import {
  fromCallModel,
  fromComponentRow,
  fromIdList,
  fromLPRow,
  fromLPRowIdentity,
  fromOffsetRow,
  fromTransferRow,
  fromYesNo,
  toCallModel,
  toIdList,
  toNumber,
  toOptionalNumber,
  toStoredAmount,
  toYesNo,
  type CallParts,
} from '../mappers';

const CALL_ID = '55555555-5555-5555-5555-555555555555';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';

/** Push a model out to the database shape and read it back. */
function roundTrip(model: CallModel): CallModel {
  const callCols = fromCallModel(model);

  const parts: CallParts = {
    call: {
      id: CALL_ID,
      client_id: CLIENT_ID,
      call_no: Number(model.setup.Call_Number ?? 1),
      ...callCols,
      source_setup: 'template',
      source_lps: 'template',
      source_components: 'template',
      source_fee: 'template',
      source_transfers: 'template',
      source_file_name: null,
      source_file_path: null,
      prepared_by: null,
      created_by: null,
      created_at: '2026-09-17T00:00:00Z',
      updated_at: '2026-09-17T00:00:00Z',
      locked_at: null,
    } as CallParts['call'],

    register: model.lps.map((l, i) => {
      const balances = fromLPRow(l, CALL_ID, `investor-${i}`, i);
      const identity = fromLPRowIdentity(l, CLIENT_ID);
      return {
        id: `reg-${i}`,
        ...balances,
        investors: {
          id: `investor-${i}`,
          lp_id: identity.lp_id,
          lp_name: identity.lp_name,
          lp_type: identity.lp_type,
          contact_email: identity.contact_email,
          side_letter_ref: identity.side_letter_ref,
          notes: identity.notes,
        },
      } as CallParts['register'][number];
    }),

    components: model.components.map((c, i) => {
      const row = fromComponentRow(c, CALL_ID, i);
      return {
        id: `comp-${i}`,
        ...row,
      } as CallParts['components'][number];
    }),

    offsets: (model.fee.offsets ?? []).map((o, i) => {
      const row = fromOffsetRow(o, CALL_ID, i);
      return {
        id: `off-${i}`,
        ...row,
      } as CallParts['offsets'][number];
    }),

    transfers: model.transfers.map((t, i) => {
      const row = fromTransferRow(t, CALL_ID, i);
      return {
        id: `tr-${i}`,
        ...row,
      } as CallParts['transfers'][number];
    }),

    expectedOutput: (model.golden ?? []).map((g, i) => {
      const { LP_ID, ...figures } = g;
      return {
        id: `exp-${i}`,
        call_id: CALL_ID,
        lp_id: LP_ID,
        figures,
        position: i,
      } as CallParts['expectedOutput'][number];
    }),
  };

  return toCallModel(parts);
}

describe('primitive conversions', () => {
  it('reads stored amounts without losing cents', () => {
    expect(toNumber(1393719.91)).toBe(1393719.91);
    expect(toNumber('1393719.91')).toBe(1393719.91);
    expect(toNumber(null)).toBe(0);
  });

  it('strips spreadsheet formatting before storing an amount', () => {
    // Plain Number() gives NaN for these, which would store as 0 and silently
    // wipe an investor's commitment.
    expect(toStoredAmount('10,000,000')).toBe(10000000);
    expect(toStoredAmount(' 8,000,000 ')).toBe(8000000);
    expect(toStoredAmount('$3,000,000')).toBe(3000000);
    expect(toStoredAmount('')).toBe(0);
  });

  it('keeps "not set" distinct from zero for optional numerics', () => {
    // A blank fee override means "use the fund default", not "charge 0%".
    expect(toOptionalNumber(null)).toBe('');
    expect(toOptionalNumber('')).toBe('');
    expect(toOptionalNumber('0.01')).toBe(0.01);
    expect(toOptionalNumber(0)).toBe(0);
  });

  it('round-trips Y/N flags through booleans', () => {
    expect(toYesNo(fromYesNo('Y'))).toBe('Y');
    expect(toYesNo(fromYesNo('N'))).toBe('N');
    expect(toYesNo(fromYesNo('y'))).toBe('Y');
    expect(fromYesNo('true')).toBe(false);
    expect(fromYesNo(undefined)).toBe(false);
  });

  it('round-trips ID lists through text[]', () => {
    expect(toIdList(fromIdList('LP02, GP01'))).toBe('LP02, GP01');
    expect(fromIdList('LP01;LP02 , LP03')).toEqual(['LP01', 'LP02', 'LP03']);
    expect(fromIdList('')).toEqual([]);
    expect(toIdList(null)).toBe('');
  });
});

describe('call model round-trip', () => {
  it('still matches the accountant’s Expected_Output to the cent', () => {
    const result = compute(roundTrip(ILLUSTRATIVE_FUND));
    expect(result.goldenDiffs).toEqual([]);
    expect(result.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('produces identical figures to computing the model directly', () => {
    const direct = compute(ILLUSTRATIVE_FUND);
    const viaDb = compute(roundTrip(ILLUSTRATIVE_FUND));
    expect(viaDb.rows.map((r) => r.total)).toEqual(direct.rows.map((r) => r.total));
    expect(viaDb.totals).toEqual(direct.totals);
    expect(viaDb.checks).toEqual(direct.checks);
  });

  it('preserves the side-letter override and the fee exemption', () => {
    const model = roundTrip(ILLUSTRATIVE_FUND);
    expect(model.lps.find((l) => l.LP_ID === 'LP03')?.Mgmt_Fee_Rate_Override).toBe(0.01);
    expect(model.lps.find((l) => l.LP_ID === 'LP01')?.Mgmt_Fee_Rate_Override).toBe('');
    expect(model.lps.find((l) => l.LP_ID === 'GP01')?.Fee_Exempt).toBe('Y');
    expect(model.fee.Fee_Exempt_LP_IDs).toBe('GP01');
  });

  it('preserves whether each component reduces unfunded commitment', () => {
    const model = roundTrip(ILLUSTRATIVE_FUND);
    expect(model.components.find((c) => c.Component_ID === 'C4')?.Reduces_Unfunded).toBe('Y');
    expect(model.components.find((c) => c.Component_ID === 'C5')?.Reduces_Unfunded).toBe('N');
  });

  // Every edge case the engine suite covers has to survive storage too, or the
  // database becomes a place where correct inputs turn into wrong ones.
  for (const [name, model] of Object.entries(SCENARIOS)) {
    it(`survives storage unchanged: ${name}`, () => {
      const direct = compute(structuredClone(model));
      const viaDb = compute(roundTrip(structuredClone(model)));
      expect(viaDb.rows.map((r) => r.total)).toEqual(direct.rows.map((r) => r.total));
      expect(viaDb.totals).toEqual(direct.totals);
      expect(viaDb.goldenDiffs).toEqual(direct.goldenDiffs);
    });
  }
});

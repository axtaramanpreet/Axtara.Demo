/**
 * Integration tests against a real Postgres.
 *
 * The mapper tests prove the translation is lossless in memory. These prove it
 * survives the database: the illustrative fund is written through
 * `save_call_inputs`, read back through PostgREST, and recomputed — and the
 * accountant's Expected_Output still has to match to the cent.
 *
 * Requires the local stack (`npm run db:start`). Skipped, loudly, when it is
 * not running, so the unit suite stays runnable without Docker.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compute, emptyCall } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import { createSupabaseRepository } from '../supabase-repository';
import type { SupabaseClient } from '../supabase-client';
import type { CallRepository, CallSources } from '../types';
import { LOCAL_URL, createLocalServiceClient } from './local-stack';

const db = createLocalServiceClient();

const CLIENT_ID = '0e57f19a-0000-4000-8000-00000000f127';
const FUND_ID = '0e57f19a-0000-4000-8000-00000000c11e';

async function databaseIsUp(): Promise<boolean> {
  try {
    const { error } = await db.from('clients').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

const up = await databaseIsUp();

const ALL_SOURCES: CallSources = {
  setup: 'template',
  lps: 'template',
  components: 'template',
  fee: 'template',
  transfers: 'template',
};

describe.skipIf(!up)('Supabase repository (integration)', () => {
  let repo: CallRepository;

  beforeAll(async () => {
    await db.from('clients').delete().eq('id', CLIENT_ID);
    await db.from('clients').insert({ id: CLIENT_ID, name: 'Integration Test Client' });
    // Deliberately not named like the seeded fund: a shared name once made the
    // row-level-security test pick up this fixture's calls instead of the seed's.
    await db
      .from('funds')
      .insert({ id: FUND_ID, client_id: CLIENT_ID, name: 'Integration Test Fund, L.P.' });
    repo = createSupabaseRepository(db as unknown as SupabaseClient);
  });

  afterAll(async () => {
    // Order matters, and the result is checked. `call_register.investor_id` is
    // ON DELETE RESTRICT, so deleting the client while register rows still point
    // at its investors fails — and an unchecked failure here quietly left more
    // than a hundred stray calls behind before this was noticed.
    await db.from('calls').delete().eq('fund_id', FUND_ID);
    await db.from('investors').delete().eq('fund_id', FUND_ID);
    await db.from('funds').delete().eq('id', FUND_ID);
    const { error } = await db.from('clients').delete().eq('id', CLIENT_ID);
    expect(error).toBeNull();

    const { data: leftovers } = await db.from('calls').select('id').eq('fund_id', FUND_ID);
    expect(leftovers ?? []).toEqual([]);
  });

  it('writes and reads back a call whose figures still tie to the workbook', async () => {
    const created = await repo.createCall(FUND_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const loaded = await repo.getCall(created.id);
    expect(loaded).not.toBeNull();

    const viaDb = compute(loaded!.model);
    const direct = compute(ILLUSTRATIVE_FUND);

    expect(viaDb.goldenDiffs).toEqual([]);
    expect(viaDb.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(viaDb.rows.map((r) => r.total)).toEqual(direct.rows.map((r) => r.total));
    expect(viaDb.totals.total).toBeCloseTo(7037500, 2);
  });

  it('numbers calls sequentially per fund', async () => {
    const a = await repo.createCall(FUND_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const b = await repo.createCall(FUND_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    expect(b.callNo).toBe(a.callNo + 1);
  });

  it('reports a call with inputs as in progress', async () => {
    const created = await repo.createCall(FUND_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const calls = await repo.listCalls(FUND_ID);
    const found = calls.find((c) => c.id === created.id);
    expect(found?.stage).toBe('in_progress');
    expect(found?.activeInvestors).toBe(6);
    // Nothing is issued, so there is no frozen total to report.
    expect(found?.totalCalled).toBeNull();
  });

  it('preserves the side-letter override and fee exemption through storage', async () => {
    const created = await repo.createCall(FUND_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const loaded = await repo.getCall(created.id);
    const lps = loaded!.model.lps;
    expect(lps.find((l) => l.LP_ID === 'LP03')?.Mgmt_Fee_Rate_Override).toBe(0.01);
    expect(lps.find((l) => l.LP_ID === 'GP01')?.Fee_Exempt).toBe('Y');
    expect(loaded!.model.fee.Fee_Exempt_LP_IDs).toBe('GP01');
    expect(lps.find((l) => l.LP_ID === 'LP01')?.Contact_Email).toBe(
      'treasury@alphapension.example',
    );
  });

  /**
   * The write path used to invent values for anything left blank: 'USD' for the
   * currency, 'Commitment' for both fee bases, and — worst — `Number('')`, which
   * is 0, for the rounding decimals. A fund calling in cents that had simply not
   * filled the field in was stored as rounding to whole units.
   */
  it('stores a blank call without inventing values for it', async () => {
    const created = await repo.createCall(FUND_ID, emptyCall('Blank Fund, L.P.'), {
      setup: 'empty',
      lps: 'empty',
      components: 'empty',
      fee: 'empty',
      transfers: 'empty',
    });
    const loaded = await repo.getCall(created.id);
    const setup = loaded!.model.setup;

    expect(setup.Fund_Name).toBe('Blank Fund, L.P.');
    expect(setup.Reporting_Currency).toBe('');
    expect(setup.Rounding_Decimals).toBe('');
    expect(setup.Default_Mgmt_Fee_Basis).toBe('');
    expect(setup.Call_Date).toBe('');
    expect(setup.Payment_Due_Date).toBe('');
    expect(loaded!.model.fee.Fee_Basis).toBe('');

    // Blank still means cents, not whole units.
    expect(compute(loaded!.model).d).toBe(2);
  });

  it('keeps a currency that was chosen, upper-cased for the column', async () => {
    const model = emptyCall('Cased Fund, L.P.');
    model.setup.Reporting_Currency = 'eur';
    const created = await repo.createCall(FUND_ID, model, {
      setup: 'manual', lps: 'empty', components: 'empty', fee: 'empty', transfers: 'empty',
    });
    expect((await repo.getCall(created.id))!.model.setup.Reporting_Currency).toBe('EUR');
  });

  // Note: nothing here locks a call. Issuing one is permanent by design — the
  // trigger refuses to unlock or delete it, so a test that locked a call would
  // leave a row no teardown could remove. The lock and its refusals are covered
  // by supabase/tests/immutability.test.sql, at the level that enforces them;
  // what this layer owes is the message an accountant sees, tested directly
  // against asError below.

  // The whole point of the storage layer is that it changes nothing. If any
  // scenario computes differently after a database round trip, the database is
  // introducing error into figures sent to investors.
  for (const [name, model] of Object.entries(SCENARIOS)) {
    it(`round-trips through Postgres unchanged: ${name}`, async () => {
      const created = await repo.createCall(FUND_ID, model, ALL_SOURCES);
      const loaded = await repo.getCall(created.id);

      const direct = compute(structuredClone(model));
      const viaDb = compute(loaded!.model);

      expect(viaDb.rows.map((r) => r.total)).toEqual(direct.rows.map((r) => r.total));
      expect(viaDb.totals.total).toBeCloseTo(direct.totals.total, 2);
      expect(viaDb.goldenDiffs).toEqual(direct.goldenDiffs);
    });
  }
});

if (!up) {
  // A silent skip would let this rot unnoticed.
  console.warn(
    '\n  Supabase integration tests skipped — local stack not reachable at ' +
      LOCAL_URL +
      '.\n  Start it with `npm run db:start`.\n',
  );
}

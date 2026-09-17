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

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import type { Database } from '../database.types';
import { createSupabaseRepository } from '../supabase-repository';
import type { SupabaseClient } from '../supabase-client';
import type { CallRepository, CallSources } from '../types';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The CLI's well-known local service key. Valid only against 127.0.0.1.
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const db = createClient<Database>(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FIRM_ID = '0e57f19a-0000-4000-8000-00000000f127';
const CLIENT_ID = '0e57f19a-0000-4000-8000-00000000c11e';

async function databaseIsUp(): Promise<boolean> {
  try {
    const { error } = await db.from('firms').select('id').limit(1);
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
    await db.from('firms').delete().eq('id', FIRM_ID);
    await db.from('firms').insert({ id: FIRM_ID, name: 'Integration Test Administrators' });
    await db
      .from('clients')
      .insert({ id: CLIENT_ID, firm_id: FIRM_ID, name: 'Illustrative Fund II, L.P.' });
    repo = createSupabaseRepository(db as unknown as SupabaseClient);
  });

  afterAll(async () => {
    // Cascades through clients, calls and their inputs.
    await db.from('firms').delete().eq('id', FIRM_ID);
  });

  it('writes and reads back a call whose figures still tie to the workbook', async () => {
    const created = await repo.createCall(CLIENT_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
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
    const a = await repo.createCall(CLIENT_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const b = await repo.createCall(CLIENT_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    expect(b.callNo).toBe(a.callNo + 1);
  });

  it('reports a call with inputs as in progress', async () => {
    const created = await repo.createCall(CLIENT_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const calls = await repo.listCalls(CLIENT_ID);
    const found = calls.find((c) => c.id === created.id);
    expect(found?.stage).toBe('in_progress');
    expect(found?.activeInvestors).toBe(6);
    // Nothing is issued, so there is no frozen total to report.
    expect(found?.totalCalled).toBeNull();
  });

  it('preserves the side-letter override and fee exemption through storage', async () => {
    const created = await repo.createCall(CLIENT_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const loaded = await repo.getCall(created.id);
    const lps = loaded!.model.lps;
    expect(lps.find((l) => l.LP_ID === 'LP03')?.Mgmt_Fee_Rate_Override).toBe(0.01);
    expect(lps.find((l) => l.LP_ID === 'GP01')?.Fee_Exempt).toBe('Y');
    expect(loaded!.model.fee.Fee_Exempt_LP_IDs).toBe('GP01');
    expect(lps.find((l) => l.LP_ID === 'LP01')?.Contact_Email).toBe(
      'treasury@alphapension.example',
    );
  });

  it('refuses to edit a call once it has been issued', async () => {
    const created = await repo.createCall(CLIENT_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    await db.from('calls').update({ locked_at: new Date().toISOString() }).eq('id', created.id);

    await expect(repo.saveCall(created.id, ILLUSTRATIVE_FUND, ALL_SOURCES)).rejects.toThrow(
      /has been issued/i,
    );

    // Unlock so the fixture teardown can cascade normally.
    await db.from('calls').update({ locked_at: null }).eq('id', created.id);
  });

  // The whole point of the storage layer is that it changes nothing. If any
  // scenario computes differently after a database round trip, the database is
  // introducing error into figures sent to investors.
  for (const [name, model] of Object.entries(SCENARIOS)) {
    it(`round-trips through Postgres unchanged: ${name}`, async () => {
      const created = await repo.createCall(CLIENT_ID, model, ALL_SOURCES);
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
      URL +
      '.\n  Start it with `npm run db:start`.\n',
  );
}

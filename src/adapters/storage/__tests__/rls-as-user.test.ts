/**
 * End-to-end check as a real signed-in user.
 *
 * Everything else tests a layer: pgTAP tests the policies, the repository
 * integration tests use the service role and so bypass them entirely. This is
 * the only test that goes the way the application does — sign in with the anon
 * key, read through row-level security, and recompute.
 *
 * If a policy is too tight, this is what catches it: the accountant sees an
 * empty screen rather than an error, which no other test would notice.
 *
 * Requires the local stack with its seed (`npm run db:reset`).
 */

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import type { Database } from '../database.types';
import { createSupabaseRepository } from '../supabase-repository';
import type { SupabaseClient } from '../supabase-client';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

// Fixed ids from supabase/seed.sql. Matching on name is too loose — another
// fixture sharing it would silently redirect these assertions.
const SEEDED_FUND_II = '00000000-0000-4000-8000-0000000000c1';
const SEEDED_FUND_III = '00000000-0000-4000-8000-0000000000c2';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function signInAsSeededUser() {
  const db = createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({
    email: 'dev@axtara.local',
    password: 'password',
  });
  return error ? null : db;
}

const db = await signInAsSeededUser().catch(() => null);

describe.skipIf(!db)('reading the seeded fund as a signed-in user', () => {
  const repo = createSupabaseRepository(db as unknown as SupabaseClient);

  it('sees both of the firm’s funds and nothing else', async () => {
    const clients = await repo.listClients();
    expect(clients.map((c) => c.name).sort()).toEqual([
      'Illustrative Fund II, L.P.',
      'Illustrative Fund III, L.P.',
    ]);
  });

  it('lists the seeded call as in progress', async () => {
    const calls = await repo.listCalls(SEEDED_FUND_II);

    expect(calls).toHaveLength(1);
    expect(calls[0].callNo).toBe(2);
    expect(calls[0].stage).toBe('in_progress');
    expect(calls[0].activeInvestors).toBe(6);
    // Nothing issued, so there is no frozen snapshot to report a total from.
    expect(calls[0].totalCalled).toBeNull();
  });

  it('computes the seeded call to the accountant’s Expected_Output', async () => {
    const [call] = await repo.listCalls(SEEDED_FUND_II);
    const detail = await repo.getCall(call.id);

    const result = compute(detail!.model);

    expect(result.goldenDiffs).toEqual([]);
    expect(result.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(result.totals.total).toBeCloseTo(7037500, 2);
    expect(result.rows.find((r) => r.LP_ID === 'LP01')?.total).toBeCloseTo(1393719.91, 2);
  });

  /**
   * The three ledger lines on the Home card have to agree with each other:
   * commitments less what investors have already paid in is what remains
   * unfunded. Deriving unfunded from issued calls alone once reported a fund
   * with 9.8m already contributed as having its full 50.5m outstanding.
   */
  it('reports a fund position whose lines reconcile', async () => {
    const position = await repo.getClientPosition(SEEDED_FUND_II);

    expect(position).not.toBeNull();
    expect(position!.totalCommitments).toBeCloseTo(50500000, 2);
    expect(position!.paidInCapital).toBeCloseTo(9800000, 2);
    expect(position!.unfundedCommitment).toBeCloseTo(40700000, 2);
    expect(position!.investors).toBe(6);

    // Nothing has been issued, so nothing has been called.
    expect(position!.callsIssued).toBe(0);
    expect(position!.calledToDate).toBeCloseTo(0, 2);

    expect(position!.totalCommitments - position!.paidInCapital).toBeCloseTo(
      position!.unfundedCommitment,
      2,
    );
  });

  it('shows an empty fund as having no calls', async () => {
    expect(await repo.listCalls(SEEDED_FUND_III)).toEqual([]);
  });
});

if (!db) {
  console.warn(
    '\n  RLS tests skipped — could not sign in at ' +
      URL +
      '.\n  Run `npm run db:reset` to apply the seed.\n',
  );
}

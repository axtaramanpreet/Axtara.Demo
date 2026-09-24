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

import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { createSupabaseRepository } from '../supabase-repository';
import type { SupabaseClient } from '../supabase-client';
import {
  LOCAL_ANON_KEY,
  LOCAL_URL,
  createLocalClient,
  createLocalServiceClient,
} from './local-stack';

// Fixed ids from supabase/seed.sql. Matching on name is too loose — another
// fixture sharing it would silently redirect these assertions.
const SEEDED_FUND_II = '00000000-0000-4000-8000-0000000000c1';
const SEEDED_FUND_III = '00000000-0000-4000-8000-0000000000c2';

async function signInAsSeededUser() {
  const db = createLocalClient(LOCAL_ANON_KEY);
  const { error } = await db.auth.signInWithPassword({
    email: 'dev@axtara.local',
    password: 'password',
  });
  return error ? null : db;
}

const db = await signInAsSeededUser().catch(() => null);

describe.skipIf(!db)('reading the seeded fund as a signed-in user', () => {
  const repo = createSupabaseRepository(db as unknown as SupabaseClient);

  /**
   * Asserts membership rather than an exact list. Listing every fund by name
   * meant the test failed the moment anyone created one through the app, which
   * is a test that punishes using the product. What actually matters is the
   * policy: this client's funds are visible, another client's are not.
   */
  it('sees its own client’s funds, and not another client’s', async () => {
    expect((await repo.listFunds()).map((c) => c.id)).toEqual(
      expect.arrayContaining([SEEDED_FUND_II, SEEDED_FUND_III]),
    );

    // Arranged with the service role because a signed-in user cannot create a
    // fund outside their own client — which is the thing being tested.
    const service = createLocalServiceClient();
    const clientId = crypto.randomUUID();
    const fundId = crypto.randomUUID();

    const { error: clientError } = await service
      .from('clients')
      .insert({ id: clientId, name: `Rival Client ${clientId.slice(0, 8)}` });
    expect(clientError).toBeNull();

    try {
      const { error: fundError } = await service
        .from('funds')
        .insert({ id: fundId, client_id: clientId, name: 'Someone Else’s Fund, L.P.' });
      expect(fundError).toBeNull();

      expect((await repo.listFunds()).map((c) => c.id)).not.toContain(fundId);
    } finally {
      // Dependency order, and asserted: a silent cleanup failure once left 122
      // stray rows behind and broke later runs.
      const { error: fundCleanup } = await service.from('funds').delete().eq('id', fundId);
      const { error: clientCleanup } = await service.from('clients').delete().eq('id', clientId);
      expect(fundCleanup).toBeNull();
      expect(clientCleanup).toBeNull();
    }
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
    const position = await repo.getFundPosition(SEEDED_FUND_II);

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

  /**
   * Creates its own fund rather than asserting the seeded one is still empty.
   * Anyone using the app locally will add a call to it sooner or later, and a
   * test that breaks when the app is used is a test nobody keeps.
   */
  it('shows a fund with no calls as empty', async () => {
    const fund = await repo.createFund(`Empty Fund ${Date.now()}`);
    try {
      expect(await repo.listCalls(fund.id)).toEqual([]);
      expect((await repo.getFundPosition(fund.id))?.callsIssued).toBe(0);
    } finally {
      await repo.deleteFund(fund.id);
    }
  });

  it('can delete a fund that has no history', async () => {
    const fund = await repo.createFund(`Throwaway ${Date.now()}`);
    await repo.deleteFund(fund.id);
    expect((await repo.listFunds()).map((c) => c.id)).not.toContain(fund.id);
  });
});

if (!db) {
  console.warn(
    '\n  RLS tests skipped — could not sign in at ' +
      LOCAL_URL +
      '.\n  Run `npm run db:reset` to apply the seed.\n',
  );
}

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
import { BLANK_TERMS, termsOn } from '@/engine/fund-terms';
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
    // Whatever an interrupted run left behind, in the order the keys allow.
    await db.from('calls').delete().eq('fund_id', FUND_ID);
    await db.from('closings').delete().eq('fund_id', FUND_ID);
    await db.from('investors').delete().eq('fund_id', FUND_ID);
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
    // Draft closings too: their commitments hold investors, so a closing left
    // by a test that failed part-way would block every delete after it.
    await db.from('closings').delete().eq('fund_id', FUND_ID);
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

  it('keeps fund terms as a dated history, blanks as blanks', async () => {
    const [first] = await repo.addFundTerms(FUND_ID, [{
      ...BLANK_TERMS,
      effectiveFrom: '2024-01-01',
      reportingCurrency: 'usd',
      feeBasis: 'Commitment',
      feeRateAnnual: 0.02,
      feeReducesUnfunded: true,
      feeExemptLpIds: ['GP01', ' '],
      feeTiming: 'arrears',
    }]);
    await repo.addFundTerms(FUND_ID, [{
      ...BLANK_TERMS,
      effectiveFrom: '2029-01-01',
      feeBasis: 'Invested_Capital',
      feeRateAnnual: 0.015,
    }]);

    const history = await repo.listFundTerms(FUND_ID);
    expect(history.map((t) => t.effectiveFrom)).toEqual(['2024-01-01', '2029-01-01']);

    // What went in is what comes back, bar the tidying a column needs.
    expect(first.reportingCurrency).toBe('USD');
    expect(first.feeRateAnnual).toBe(0.02);
    expect(first.feeReducesUnfunded).toBe(true);
    expect(first.feeExemptLpIds).toEqual(['GP01']);
    expect(first.feeTiming).toBe('arrears');

    // Blank is "not set", not zero and not false — the screen depends on it.
    expect(first.orgExpenseCap).toBeNull();
    expect(first.roundingDecimals).toBeNull();
    expect(first.feeDayCount).toBeNull();

    expect(termsOn(history, '2030-06-30')?.feeRateAnnual).toBe(0.015);
    expect(termsOn(history, '2026-06-30')?.feeRateAnnual).toBe(0.02);
  });

  it('records several dated rows as one, or none of them', async () => {
    const before = (await repo.listFundTerms(FUND_ID)).length;
    // The second row breaks a column rule, so the first must not land either.
    await expect(
      repo.addFundTerms(FUND_ID, [
        { ...BLANK_TERMS, effectiveFrom: '2030-01-01', feeRateAnnual: 0.01 },
        { ...BLANK_TERMS, effectiveFrom: '2031-01-01', roundingDecimals: 9 },
      ]),
    ).rejects.toThrow();
    expect((await repo.listFundTerms(FUND_ID)).length).toBe(before);
  });

  it('lists the fund\u2019s investors by LP_ID', async () => {
    await repo.createCall(FUND_ID, ILLUSTRATIVE_FUND, ALL_SOURCES);
    const investors = await repo.listInvestors(FUND_ID);
    expect(investors.map((i) => i.lpId)).toEqual(['GP01', 'LP01', 'LP02', 'LP03', 'LP04', 'LP05']);
    expect(investors.find((i) => i.lpId === 'LP04')?.name).toBe('Delta Insurance Co');
  });

  it('drafts a closing, saves who it admits in one go, and reads it back', async () => {
    const first = await repo.createClosing(FUND_ID, '2026-01-15', 'First close');
    expect(first.closingNo).toBe(1);
    expect(first.finalised).toBe(false);

    await repo.saveClosingCommitments(first.id, [
      { lpId: 'LP01', name: 'Alpha Pension Trust', amount: 10_000_000 },
      { lpId: 'LP50', name: 'Brand New Endowment', amount: 2_500_000, feeRateOverride: 0.01, contactEmail: 'ops@new.example' },
    ]);

    const [loaded] = (await repo.listClosings(FUND_ID)).filter((c) => c.id === first.id);
    expect(loaded.commitments.map((k) => [k.lpId, k.amount, k.feeRateOverride])).toEqual([
      ['LP01', 10_000_000, null],
      ['LP50', 2_500_000, 0.01],
    ]);
    expect(loaded.commitments[1].contactEmail).toBe('ops@new.example');
    // An investor new to the fund exists now, for every later call and closing.
    expect((await repo.listInvestors(FUND_ID)).some((i) => i.lpId === 'LP50')).toBe(true);

    const second = await repo.createClosing(FUND_ID, '2026-08-01');
    expect(second.closingNo).toBe(2);
    // How far the fund has got, as the sidebar and checklist read it: terms were
    // recorded above, two closings are drafted, none finalised.
    expect(await repo.getFundProgress(FUND_ID)).toMatchObject({ hasTerms: true, closings: 2, finalisedClosings: 0 });
    await repo.updateClosing(second.id, { closingDate: '2026-08-15', note: 'Second close' });
    expect((await repo.listClosings(FUND_ID)).find((c) => c.id === second.id)).toMatchObject({
      closingDate: '2026-08-15',
      note: 'Second close',
    });

    await repo.deleteClosing(second.id);
    await repo.deleteClosing(first.id);
    expect(await repo.listClosings(FUND_ID)).toEqual([]);
  });

  it('has no issued calls for a fund that has done nothing', async () => {
    expect(await repo.listIssuedCalls(FUND_ID)).toEqual([]);
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

  it('keeps the fee periods a call bills, exactly', async () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.feeSchedule = [{ from: '2026-04-01', to: '2026-06-30', label: 'Q2 2026', byLp: { LP01: 125_000.5, LP02: 37_500 } }];
    const created = await repo.createCall(FUND_ID, model, ALL_SOURCES);
    expect((await repo.getCall(created.id))!.model.feeSchedule).toEqual(model.feeSchedule);
    await repo.saveCall(created.id, { ...model, feeSchedule: null }, {});
    expect((await repo.getCall(created.id))!.model.feeSchedule).toBeUndefined();
  });

  it('keeps an investor’s profile when a call’s register leaves their details blank', async () => {
    const investor = await repo.createInvestor(FUND_ID, 'LP77', {
      name: 'Profile Kept Endowment',
      type: 'Endowment',
      email: 'ir@kept.example',
      ccEmails: ['cfo@kept.example'],
      country: 'Ireland',
      kycStatus: 'approved',
    });
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.lps = [{ ...model.lps[0], LP_ID: 'LP77', LP_Name: '', LP_Type: '', Contact_Email: '', Notes: '' }];
    await repo.createCall(FUND_ID, model, ALL_SOURCES);

    const [kept] = (await repo.listInvestors(FUND_ID)).filter((i) => i.id === investor.id);
    expect(kept).toMatchObject({
      name: 'Profile Kept Endowment',
      type: 'Endowment',
      email: 'ir@kept.example',
      ccEmails: ['cfo@kept.example'],
      country: 'Ireland',
      kycStatus: 'approved',
    });
    await repo.updateInvestor(investor.id, { country: '', ccEmails: [] });
    const [cleared] = (await repo.listInvestors(FUND_ID)).filter((i) => i.id === investor.id);
    // Clearing is the Investors page's to do, and it does.
    expect([cleared.country, cleared.ccEmails]).toEqual([null, []]);
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

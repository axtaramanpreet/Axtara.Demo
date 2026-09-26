/**
 * The demo fund: Meridian Growth Partners III, told as one story.
 *
 *   1. Terms in Settings: 2% on commitment, quarterly in advance; 1.5% on
 *      invested capital after the investment period; 8% late-close interest;
 *      where to wire.
 *   2. The investor register, then the first close, finalised: five
 *      investors and the GP, 100m, each with a full profile.
 *   3. Capital Call No. 1, issued: the register read from the first close,
 *      Q1's management fee, notices sent (recorded as sent, not emailed).
 *   4. Second close, left as a draft: two late investors, 20m, named only by
 *      the closing — so their profiles show as unfinished. Finalising it on
 *      screen shows the equalization and asks how it is settled (statements
 *      now, or on the next call). Management fees then shows Q2 and Q3 still
 *      owed, the late investors' share included. A second call bills them at
 *      once, as a fund does that paid its manager from a credit line — and,
 *      settled on the next call, carries the late investors' equalization.
 *
 * Every step goes through the app's own code as the demo user — the same
 * checks, the same records, the same audit log. Dates are placed around
 * today, so the story always reads as current.
 *
 * Local by default. It refuses a hosted database unless DEMO_ALLOW_REMOTE=1,
 * and signs in as DEMO_EMAIL / DEMO_PASSWORD (dev@axtara.local / password,
 * the local seed user, when unset). Re-running archives the previous demo
 * fund and builds a fresh one.
 */

import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createServerSupabase, createServiceSupabase } from '@/adapters/storage/supabase-client';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import {
  afterInvestmentPeriod,
  buildFeeSchedule,
  defaultFeePeriods,
  feeOwed,
  applyFundTerms,
  BLANK_TERMS,
  compute,
  dayAfter,
  dayBefore,
  emptyCall,
  fundRegister,
  periodContaining,
  termsOn,
  type ComponentRow,
  type FundTerms,
  type IssuedCall,
} from '@/engine';
import { approveNotices, sendNotices } from '@/server/call-actions';
import { finaliseClosing } from '@/server/fund-actions';
import type { UserSupabase } from '@/server/session';

// The app reads its settings when it runs, not when it loads, so this is early enough.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const FUND = 'Meridian Growth Partners III';

/** `date` moved by whole months, on the same day of the month. */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Where each event falls, around today. */
export function demoDates(today: string) {
  const quarter = periodContaining(today, 3).from;
  const firstClose = addDays(addMonths(quarter, -6), 14);
  const callDate = addMonths(firstClose, 2);
  // A month into this quarter, or yesterday if the quarter is younger than that.
  const wanted = addDays(quarter, 33);
  const secondClose = wanted < today ? wanted : dayBefore(today);
  return { quarter, firstClose, callDate, dueDate: addDays(callDate, 14), secondClose };
}

const FIRST_CLOSE = [
  { lpId: 'LP01', name: 'Northbridge Teachers’ Pension Plan', amount: 25_000_000, type: 'Pension', country: 'Canada', email: 'pe-ops@northbridge.example', cc: ['finance@northbridge.example'] },
  { lpId: 'LP02', name: 'Halcyon University Endowment', amount: 20_000_000, type: 'Endowment', country: 'United States', email: 'investments@halcyon.example' },
  { lpId: 'LP03', name: 'Aster Family Office', amount: 10_000_000, type: 'Family office', country: 'Switzerland', email: 'office@aster.example', rate: 0.015, sideLetter: 'SL-01 (fee 1.5%)' },
  { lpId: 'LP04', name: 'Kestrel Sovereign Holdings', amount: 30_000_000, type: 'Sovereign wealth', country: 'Singapore', email: 'fund-admin@kestrel.example', cc: ['legal@kestrel.example'] },
  { lpId: 'LP05', name: 'Linden Mutual Insurance', amount: 12_500_000, type: 'Insurance', country: 'United Kingdom', email: 'alts@linden.example', kyc: 'in_progress' as const },
  { lpId: 'GP01', name: 'Meridian Growth GP III, L.P.', amount: 2_500_000, type: 'General partner', country: 'United States', email: 'finance@meridian.example', exempt: true, gp: true },
];
const SECOND_CLOSE = [
  { lpId: 'LP07', name: 'Eta Capital Partners', amount: 15_000_000, email: 'capital-calls@eta.example' },
  { lpId: 'LP08', name: 'Solberg Foundation', amount: 5_000_000, email: 'treasury@solberg.example' },
];

const COMPONENTS: ComponentRow[] = [
  { Component_ID: 'C1', Component_Name: 'Project Atlas — Series B', Category: 'Deal', Total_Amount: 9_000_000, Allocation_Basis: 'Commitment', Reduces_Unfunded: 'Y', Excused_LP_IDs: '', Notes: 'First platform investment.' },
  { Component_ID: 'C2', Component_Name: 'Partnership expenses', Category: 'Partnership Expense', Total_Amount: 250_000, Allocation_Basis: 'Commitment', Reduces_Unfunded: 'Y', Excused_LP_IDs: '', Notes: 'Audit, legal and administration.' },
  { Component_ID: 'C3', Component_Name: 'Organizational expenses', Category: 'Organizational Expense', Total_Amount: 400_000, Allocation_Basis: 'Commitment', Reduces_Unfunded: 'N', Excused_LP_IDs: '', Notes: 'Fund formation; outside commitment, within the cap.' },
];

function termsFrom(firstClose: string): Omit<FundTerms, 'createdAt'> {
  return {
    ...BLANK_TERMS,
    effectiveFrom: firstClose,
    reportingCurrency: 'USD',
    roundingDecimals: 2,
    roundingPlugLpId: 'LP04',
    feeBasis: 'Commitment',
    feeRateAnnual: 0.02,
    feePeriodFraction: 0.25,
    feeReducesUnfunded: true,
    feeExemptLpIds: ['GP01'],
    orgExpenseCap: 1_000_000,
    gpName: 'Meridian Growth GP III, L.P.',
    signatoryName: 'Priya Raman',
    signatoryTitle: 'Chief Financial Officer',
    investmentPeriodEnd: addDays(addMonths(firstClose, 60), -1),
    fundTermEnd: addDays(addMonths(firstClose, 120), -1),
    feeTiming: 'advance',
    feeDayCount: 'period_fraction',
    lateCloseInterestRate: 0.08,
    lateCloseInterestBasis: 'simple',
    catchUpFeeTo: 'gp',
    equalizationInterestTo: 'existing_lps',
    paymentBankName: 'First Harbour Bank, N.A.',
    paymentAccountName: 'Meridian Growth Partners III, L.P.',
    paymentAccountNo: '4402 118 930',
    paymentSwift: 'FHBKUS33',
    paymentRouting: 'ABA 021 000 089',
    paymentReference: '{LP_ID}/MGP3/{CALL_NO}',
    note: 'From the LPA, sections 4.2 (management fee) and 3.5 (subsequent closings).',
  };
}

async function signIn(): Promise<UserSupabase> {
  const email = process.env.DEMO_EMAIL || 'dev@axtara.local';
  const password = process.env.DEMO_PASSWORD || 'password';
  const jar = new Map<string, string>();
  const client = createServerSupabase({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name, value) => void jar.set(name, value),
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client as unknown as UserSupabase;
}

it(`resets ${FUND}`, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/.test(url) && process.env.DEMO_ALLOW_REMOTE !== '1') {
    throw new Error(`Refusing to write the demo fund to ${url || 'an unset database'}: set DEMO_ALLOW_REMOTE=1 to mean it.`);
  }

  const client = await signIn();
  const repo = createSupabaseRepository(client as unknown as SupabaseClient);
  const service = createServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const when = demoDates(today);

  // Nothing about a fund can be deleted once it has issued anything, so the
  // last demo fund is archived: out of every list, still on the record.
  const previous = (await repo.listFunds()).filter((f) => f.name === FUND);
  for (const f of previous) {
    const { error } = await service.from('funds').update({ archived_at: new Date().toISOString() }).eq('id', f.id);
    if (error) throw new Error(`Could not archive the previous demo fund: ${error.message}`);
  }

  // 1. Terms
  const fund = await repo.createFund(FUND);
  const terms = termsFrom(when.firstClose);
  await repo.addFundTerms(fund.id, [terms, afterInvestmentPeriod(terms, { feeBasis: 'Invested_Capital', feeRateAnnual: 0.015 })]);

  // 2. The investor register, as onboarded, then the first close
  for (const k of FIRST_CLOSE) {
    await repo.createInvestor(fund.id, k.lpId, {
      name: k.name,
      type: k.type,
      email: k.email,
      ccEmails: k.cc ?? [],
      country: k.country,
      isGp: Boolean(k.gp),
      kycStatus: k.kyc ?? 'approved',
      sideLetterRef: k.sideLetter ?? null,
    });
  }
  const first = await repo.createClosing(fund.id, when.firstClose, 'First close.');
  await repo.saveClosingCommitments(
    first.id,
    FIRST_CLOSE.map((k) => ({
      lpId: k.lpId,
      name: k.name,
      amount: k.amount,
      contactEmail: k.email,
      feeRateOverride: k.rate ?? null,
      feeExempt: Boolean(k.exempt),
    })),
  );
  await finaliseClosing(fund.id, first.id, { client });

  // 3. Call 1, from the fund's investors
  const history = {
    terms: await repo.listFundTerms(fund.id),
    closings: await repo.listClosings(fund.id),
    calls: [] as IssuedCall[],
  };
  const register = fundRegister(history, when.callDate, null);
  if (!register.ok) throw new Error(register.problems.join(' '));
  const { model } = applyFundTerms(emptyCall(FUND), termsOn(history.terms, when.callDate), { prefillPlug: true });
  model.setup = { ...model.setup, Call_Number: 1, Call_Date: when.callDate, Payment_Due_Date: when.dueDate, Prepared_By: 'Axtara Fund Services' };
  model.lps = register.lps;
  model.components = COMPONENTS;
  // The fee for the quarter the call falls in, from the first close: Q1 is a
  // part quarter, from 15 January. Q2 and Q3 are left for a later call — the
  // credit-line story, billed together after the second close.
  const owed = feeOwed(history, when.callDate, 1);
  model.feeSchedule = buildFeeSchedule(owed, defaultFeePeriods(owed, when.callDate, 'advance'));

  const failing = compute(model).checks.filter((c) => c.level === 'fail');
  expect(failing, 'Call 1 must tie before it is issued').toEqual([]);

  const call = await repo.createCall(fund.id, model, { setup: 'manual', lps: 'carried', components: 'manual', fee: 'manual', transfers: 'empty' });
  await approveNotices(call.id, undefined, { client });
  const sent = await sendNotices(call.id, undefined, { client, deliver: false });
  expect(sent.sent).toBe(FIRST_CLOSE.length);

  // 4. Second close, drafted and left for the demo.
  const second = await repo.createClosing(fund.id, when.secondClose, 'Second close.');
  await repo.saveClosingCommitments(
    second.id,
    SECOND_CLOSE.map((k) => ({ lpId: k.lpId, name: k.name, amount: k.amount, contactEmail: k.email })),
  );

  // Straight to the terminal: Vitest holds back console output from a passing run.
  process.stdout.write(
    [
      `${FUND} is ready${previous.length ? ` (${previous.length} earlier copy archived)` : ''}.`,
      `  First close ${when.firstClose}, finalised · Call No. 1 dated ${when.callDate}, issued (not emailed)`,
      `  Second close ${when.secondClose}, draft`,
      `  Open: /funds/${fund.id}`,
    ].join('\n') + '\n',
  );
});

// The dates must make a story in any week of the year.
it('places every event in order, in the past', () => {
  for (const today of ['2026-01-01', '2026-02-20', '2026-07-01', '2026-09-25', '2026-12-31']) {
    const w = demoDates(today);
    expect(w.firstClose < w.callDate && w.callDate < w.dueDate).toBe(true);
    expect(w.dueDate < w.secondClose && w.secondClose < today).toBe(true);
    expect(dayAfter(w.secondClose) <= today).toBe(true);
  }
});

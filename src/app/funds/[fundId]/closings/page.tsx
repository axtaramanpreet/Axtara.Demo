import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import type { ClosingCommitmentInput } from '@/adapters/storage/types';
import { num, positionsOn, type EqualizationResult, type FundHistory } from '@/engine';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { equalizationFor } from '@/server/fund-actions';
import { AppShell } from '@/components/shell/app-shell';
import { ClosingsScreen } from '@/components/closings/closings-screen';
import { StepGate } from '@/components/ui/step-gate';
import { fundGates, nextStep } from '@/lib/fund-gates';

/**
 * Closings: who the fund admitted, and each later close's equalization.
 *
 * Every figure is worked out here, on the server, from the record read as the
 * signed-in user: a finalised closing shows its frozen result, a draft a
 * preview of what finalising it would freeze.
 */
export default async function ClosingsPage({ params }: { params: Promise<{ fundId: string }> }) {
  const { fundId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, calls, terms, closings, issued, investors, { data: canWrite }, progress, statements] = await Promise.all([
    repo.listFunds(),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
    repo.listClosings(fundId),
    repo.listIssuedCalls(fundId),
    repo.listInvestors(fundId),
    supabase.rpc('auth_can_write_fund', { target_fund: fundId }),
    repo.getFundProgress(fundId),
    repo.listClosingStatements(fundId),
  ]);
  const fund = funds.find((f) => f.id === fundId);
  if (!fund) notFound();

  const history: FundHistory = { terms, closings, calls: issued };
  const previews: Record<string, EqualizationResult | null> = {};
  for (const c of closings) previews[c.id] = c.finalised ? c.result : equalizationFor(history, c.id);
  // Which sent calls settled each closing's equalization: once one has, how it
  // is settled is fixed.
  const settledOn: Record<string, number[]> = {};
  for (const call of issued) {
    for (const e of call.equalizationSchedule ?? []) (settledOn[e.closingId] ??= []).push(call.callNo);
  }

  // UTC, so the server and the browser agree on "today".
  const today = new Date().toISOString().slice(0, 10);

  // A fund whose investors so far came from a call's register can start its
  // first close from that register rather than retyping it.
  let registerSeed: { callNo: number; rows: ClosingCommitmentInput[] } | null = null;
  if (!closings.length && calls.length) {
    const latest = [...calls].sort((a, b) => b.callNo - a.callNo).find((c) => c.activeInvestors > 0);
    const detail = latest ? await repo.getCall(latest.id) : null;
    if (detail) {
      const rows = detail.model.lps
        .filter((l) => String(l.LP_ID ?? '').trim() && num(l.Commitment) > 0 && String(l.Status || 'Active') === 'Active')
        .map((l) => ({
          lpId: String(l.LP_ID),
          name: String(l.LP_Name ?? l.LP_ID),
          amount: num(l.Commitment),
          contactEmail: (l.Contact_Email as string) || null,
          feeRateOverride: num(l.Mgmt_Fee_Rate_Override) > 0 ? num(l.Mgmt_Fee_Rate_Override) : null,
          feeExempt: String(l.Fee_Exempt ?? '').trim().toUpperCase() === 'Y',
        }));
      if (rows.length) registerSeed = { callNo: detail.callNo, rows };
    }
  }

  const gates = fundGates(progress);

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      module="closings"
      callCount={calls.length}
      crumb={{ leaf: 'Closings' }}
      surface="module"
      askConnected={askStatusForClient().connected}
      gates={gates}
      next={nextStep(progress, 'closings')}
    >
      {gates.closings ? (
        <StepGate
          title="Closings"
          what="Who the fund admitted, and when. A later close is equalized against the investors already in."
          reason={gates.closings}
          href={`/funds/${fundId}/settings`}
          action="Record the fund’s terms"
        />
      ) : (
        <ClosingsScreen
          fundId={fundId}
          fundName={fund.name}
          closings={closings}
          previews={previews}
          settledOn={settledOn}
          statements={statements}
          positions={positionsOn(history, today)}
          investors={investors}
          registerSeed={registerSeed}
          canWrite={Boolean(canWrite)}
          today={today}
        />
      )}
    </AppShell>
  );
}

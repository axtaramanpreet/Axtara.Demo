import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { positionFromRecord, positionsOn, type FundHistory } from '@/engine';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { InvestorsScreen } from '@/components/investors/investors-screen';
import { fundGates, nextStep } from '@/lib/fund-gates';

/**
 * Investors: the fund's register, one row per investor, with where each stands.
 *
 * Balances are worked out here from the record, as Closings and Home do. A fund
 * whose record cannot be trusted to be complete (no closings, or calls that
 * disagree with them) shows each investor as their latest issued call left them.
 */
export default async function InvestorsPage({ params }: { params: Promise<{ fundId: string }> }) {
  const { fundId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, calls, investors, terms, closings, issued, { data: canWrite }, progress] = await Promise.all([
    repo.listFunds(),
    repo.listCalls(fundId),
    repo.listInvestors(fundId),
    repo.listFundTerms(fundId),
    repo.listClosings(fundId),
    repo.listIssuedCalls(fundId),
    supabase.rpc('auth_can_write_fund', { target_fund: fundId }),
    repo.getFundProgress(fundId),
  ]);
  const fund = funds.find((c) => c.id === fundId);
  if (!fund) notFound();

  // UTC, so the server and the browser agree on "today".
  const today = new Date().toISOString().slice(0, 10);
  const history: FundHistory = { terms, closings, calls: issued };
  const fromRecord = positionFromRecord(history, today) !== null;
  const latest = [...issued].sort((a, b) => b.callDate.localeCompare(a.callDate))[0];
  const positions = fromRecord
    ? positionsOn(history, today)
    : (latest?.lines ?? []).map((l) => ({
        lpId: l.lpId,
        name: l.name,
        commitment: l.commitment,
        paidIn: l.openPaid + l.total,
        unfunded: l.openUnfunded - l.reduces,
        invested: 0,
      }));

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      module="investors"
      callCount={calls.length}
      crumb={{ leaf: 'Investors' }}
      surface="module"
      askConnected={askStatusForClient().connected}
      gates={fundGates(progress)}
      next={nextStep(progress, 'investors')}
    >
      <InvestorsScreen
        fundId={fundId}
        fundName={fund.name}
        investors={investors}
        positions={positions}
        asOf={fromRecord ? 'after every issued call and closing' : latest ? `as Call No. ${latest.callNo} left them` : 'before any call'}
        canWrite={Boolean(canWrite)}
      />
    </AppShell>
  );
}

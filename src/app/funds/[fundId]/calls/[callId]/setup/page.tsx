import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { SetupScreen } from '@/components/setup/setup-screen';
import { fundGates } from '@/lib/fund-gates';

/**
 * Set up call.
 *
 * The data is loaded on the server; the screen itself is interactive, so it
 * takes over on the client from there. The previous call comes along too, so
 * the Source step can offer to carry its register forward — and the fund's
 * closings and issued calls, so that once the fund has closings the register
 * is read from the record instead.
 */
export default async function SetupPage({
  params,
}: {
  params: Promise<{ fundId: string; callId: string }>;
}) {
  const { fundId, callId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, call, calls, fundTerms, closings, issuedCalls, investors, progress] = await Promise.all([
    repo.listFunds(),
    repo.getCall(callId),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
    repo.listClosings(fundId),
    repo.listIssuedCalls(fundId),
    repo.listInvestors(fundId),
    repo.getFundProgress(fundId),
  ]);

  if (!call) notFound();

  // The most recent earlier call is the one worth carrying forward from.
  const earlier = calls
    .filter((c) => c.callNo < call.callNo)
    .sort((a, b) => b.callNo - a.callNo)[0];
  const previousCall = earlier ? await repo.getCall(earlier.id) : null;

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      callCount={calls.length}
      crumb={{
        module: { label: 'Capital calls', href: `/funds/${fundId}` },
        leaf: `Set up Call No. ${call.callNo}`,
      }}
      surface="setup"
      callNo={call.callNo}
      preparedBy={call.model.setup.Prepared_By as string | undefined}
      askConnected={askStatusForClient().connected}
      gates={fundGates(progress)}
    >
      <SetupScreen
        call={call}
        fundId={fundId}
        previousCall={previousCall}
        fundTerms={fundTerms}
        investors={investors}
        // Earlier calls only: this call's own figures are not history yet.
        record={{ closings, calls: issuedCalls.filter((c) => c.callNo !== call.callNo) }}
        // UTC, so the server and the browser agree on which terms are in force.
        today={new Date().toISOString().slice(0, 10)}
      />
    </AppShell>
  );
}

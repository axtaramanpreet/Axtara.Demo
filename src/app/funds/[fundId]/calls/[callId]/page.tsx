import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { AppShell } from '@/components/shell/app-shell';
import { CallScreen } from '@/components/call/call-screen';
import { askStatusForClient, emailStatusForClient } from '@/lib/env';
import { fundGates } from '@/lib/fund-gates';

/**
 * One capital call: Summary, Allocation, Checks and Notices.
 *
 * Loaded on the server; the screen reads the current tab from the URL, so it
 * sits behind a Suspense boundary.
 */
export default async function CallPage({
  params,
}: {
  params: Promise<{ fundId: string; callId: string }>;
}) {
  const { fundId, callId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, call, calls, fundTerms, progress] = await Promise.all([
    repo.listFunds(),
    repo.getCall(callId),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
    repo.getFundProgress(fundId),
  ]);
  if (!call) notFound();

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      callCount={calls.length}
      crumb={{
        module: { label: 'Capital calls', href: `/funds/${fundId}` },
        leaf: `Capital Call No. ${call.callNo}`,
      }}
      surface="call"
      callNo={call.callNo}
      preparedBy={call.model.setup.Prepared_By as string | undefined}
      askConnected={askStatusForClient().connected}
      gates={fundGates(progress)}
    >
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <CallScreen call={call} fundId={fundId} email={emailStatusForClient()} fundTerms={fundTerms} />
      </Suspense>
    </AppShell>
  );
}

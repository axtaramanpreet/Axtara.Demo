import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { AppShell } from '@/components/shell/app-shell';
import { CallScreen } from '@/components/call/call-screen';
import { askStatusForClient, emailStatusForClient } from '@/lib/env';

/**
 * One capital call: Summary, Allocation, Checks and Notices.
 *
 * Loaded on the server; the screen reads the current tab from the URL, so it
 * sits behind a Suspense boundary.
 */
export default async function CallPage({
  params,
}: {
  params: Promise<{ clientId: string; callId: string }>;
}) {
  const { clientId, callId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [clients, call, calls] = await Promise.all([
    repo.listClients(),
    repo.getCall(callId),
    repo.listCalls(clientId),
  ]);
  if (!call) notFound();

  return (
    <AppShell
      clients={clients}
      clientId={clientId}
      callCount={calls.length}
      crumb={{
        module: { label: 'Capital calls', href: `/clients/${clientId}` },
        leaf: `Capital Call No. ${call.callNo}`,
      }}
      surface="call"
      preparedBy={call.model.setup.Prepared_By as string | undefined}
      askConnected={askStatusForClient().connected}
    >
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <CallScreen call={call} clientId={clientId} email={emailStatusForClient()} />
      </Suspense>
    </AppShell>
  );
}

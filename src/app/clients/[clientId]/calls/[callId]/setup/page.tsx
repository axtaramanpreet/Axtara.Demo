import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { SetupScreen } from '@/components/setup/setup-screen';

/**
 * Set up call.
 *
 * The data is loaded on the server; the screen itself is interactive, so it
 * takes over on the client from there. The previous call comes along too, so
 * the Source step can offer to carry its register forward.
 */
export default async function SetupPage({
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

  // The most recent earlier call is the one worth carrying forward from.
  const earlier = calls
    .filter((c) => c.callNo < call.callNo)
    .sort((a, b) => b.callNo - a.callNo)[0];
  const previousCall = earlier ? await repo.getCall(earlier.id) : null;

  return (
    <AppShell
      clients={clients}
      clientId={clientId}
      callCount={calls.length}
      crumb={{
        module: { label: 'Capital calls', href: `/clients/${clientId}` },
        leaf: `Set up Call No. ${call.callNo}`,
      }}
      surface="setup"
      preparedBy={call.model.setup.Prepared_By as string | undefined}
      askConnected={askStatusForClient().connected}
    >
      <SetupScreen call={call} clientId={clientId} previousCall={previousCall} />
    </AppShell>
  );
}

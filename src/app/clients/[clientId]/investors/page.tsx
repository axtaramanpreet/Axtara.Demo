import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { ModulePlaceholder } from '@/components/shell/module-placeholder';

/**
 * Investors — named in the sidebar, not built.
 *
 * A real page rather than a dead nav row, so the sidebar can say what is coming
 * without pretending it is already here.
 */
export default async function InvestorsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [clients, calls] = await Promise.all([repo.listClients(), repo.listCalls(clientId)]);
  const client = clients.find((c) => c.id === clientId);
  if (!client) notFound();

  return (
    <AppShell
      clients={clients}
      clientId={clientId}
      module="investors"
      callCount={calls.length}
      crumb={{ leaf: 'Investors' }}
      surface="module"
      askConnected={askStatusForClient().connected}
    >
      <ModulePlaceholder
        fundName={client.name}
        title="Investors"
        text="The register lives inside each capital call for now — open a call and edit its LP register there. A fund-level register, carrying transfers and side letters across calls, is what belongs here."
        backHref={`/clients/${clientId}`}
      />
    </AppShell>
  );
}

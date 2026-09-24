import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { ModulePlaceholder } from '@/components/shell/module-placeholder';

/**
 * Settings — named in the sidebar, not built.
 *
 * A real page rather than a dead nav row, so the sidebar can say what is coming
 * without pretending it is already here.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ fundId: string }>;
}) {
  const { fundId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, calls] = await Promise.all([repo.listFunds(), repo.listCalls(fundId)]);
  const fund = funds.find((c) => c.id === fundId);
  if (!fund) notFound();

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      module="settings"
      callCount={calls.length}
      crumb={{ leaf: 'Settings' }}
      surface="module"
      askConnected={askStatusForClient().connected}
    >
      <ModulePlaceholder
        fundName={fund.name}
        title="Settings"
        text="Fund-level settings — the signatory, the reporting currency, the notice wording and who may issue a call — are not editable yet. They come from the workbook and from deployment configuration in the meantime."
        backHref={`/funds/${fundId}`}
      />
    </AppShell>
  );
}

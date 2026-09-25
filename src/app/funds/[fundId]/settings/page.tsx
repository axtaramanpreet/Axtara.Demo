import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { FundTermsScreen } from '@/components/settings/fund-terms-screen';

/**
 * Settings: the fund's terms.
 *
 * Read as the signed-in user, so row-level security decides what is shown.
 * Whether the form is offered is asked of the database too — the same rule
 * that decides whether the insert would be allowed — rather than guessed from
 * a role here.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ fundId: string }>;
}) {
  const { fundId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, calls, history, investors, { data: canWrite }] = await Promise.all([
    repo.listFunds(),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
    repo.listInvestors(fundId),
    supabase.rpc('auth_can_write_fund', { target_fund: fundId }),
  ]);
  const fund = funds.find((f) => f.id === fundId);
  if (!fund) notFound();

  // UTC, so the server and the browser agree on what "today" is.
  const today = new Date().toISOString().slice(0, 10);

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
      <FundTermsScreen
        fundId={fundId}
        history={history}
        investors={investors}
        today={today}
        canWrite={Boolean(canWrite)}
      />
    </AppShell>
  );
}

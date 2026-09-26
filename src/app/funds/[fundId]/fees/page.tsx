import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { catchUpFeesFor, feeLedgerFor, termsOn, type FundHistory } from '@/engine';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { FeesScreen } from '@/components/fees/fees-screen';
import { StepGate } from '@/components/ui/step-gate';
import { fundGates } from '@/lib/fund-gates';

/**
 * Management fees: every fee period, what it costs as the record stands, what
 * calls billed for it, and — where the two differ — the true-up. Nothing on it
 * is entered by hand.
 *
 * Worked out here, on the server, from the record read as the signed-in user.
 */
export default async function FeesPage({ params }: { params: Promise<{ fundId: string }> }) {
  const { fundId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, calls, terms, closings, issued, progress] = await Promise.all([
    repo.listFunds(),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
    repo.listClosings(fundId),
    repo.listIssuedCalls(fundId),
    repo.getFundProgress(fundId),
  ]);
  const fund = funds.find((f) => f.id === fundId);
  if (!fund) notFound();

  // UTC, so the server and the browser agree on "today".
  const today = new Date().toISOString().slice(0, 10);
  const history: FundHistory = { terms, closings, calls: issued };

  const gates = fundGates(progress);

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      module="fees"
      callCount={calls.length}
      crumb={{ leaf: 'Management fees' }}
      surface="module"
      askConnected={askStatusForClient().connected}
      gates={gates}
    >
      {gates.fees ? (
        <StepGate
          title="Management fees"
          what="The fee for every period since the first close, what calls billed, and any true-up due."
          reason={gates.fees}
          href={`/funds/${fundId}/${progress.hasTerms ? 'closings' : 'settings'}`}
          action={progress.hasTerms ? 'Go to Closings' : 'Record the fund’s terms'}
        />
      ) : (
        <FeesScreen
          fundId={fundId}
          ledger={feeLedgerFor(history, today)}
          catchUps={catchUpFeesFor(history)}
          terms={termsOn(terms, today)}
        />
      )}
    </AppShell>
  );
}

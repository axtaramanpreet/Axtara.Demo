import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { capitalAccount, termsOn, type FundHistory } from '@/engine';
import { getServerSupabase } from '@/lib/supabase/server';
import { askStatusForClient } from '@/lib/env';
import { AppShell } from '@/components/shell/app-shell';
import { InvestorPage, type InvestorDocument, type SideLetterTerm } from '@/components/investors/investor-page';
import { fundGates } from '@/lib/fund-gates';

/**
 * One investor: their profile, their capital account, their documents, and
 * the side-letter terms each closing recorded for them.
 *
 * Built so that it can later be shown to the investor themselves, read-only:
 * everything on it is this investor's alone.
 */
export default async function InvestorDetailPage({ params }: { params: Promise<{ fundId: string; lpId: string }> }) {
  const { fundId, lpId: raw } = await params;
  const lpId = decodeURIComponent(raw);
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
  const investor = investors.find((i) => i.lpId === lpId);
  if (!fund || !investor) notFound();

  // UTC, so the server and the browser agree on "today".
  const today = new Date().toISOString().slice(0, 10);
  const history: FundHistory = { terms, closings, calls: issued };
  const account = capitalAccount(history, lpId, today, termsOn(terms, today)?.roundingDecimals ?? 2);

  // Their notice on every issued call, and their statement for every later close.
  const callId = new Map(calls.map((c) => [c.callNo, c.id]));
  const documents: InvestorDocument[] = [
    ...issued
      .filter((c) => c.lines.some((l) => l.lpId === lpId) && callId.has(c.callNo))
      .map((c) => ({
        date: c.callDate,
        label: `Capital Call No. ${c.callNo} — notice`,
        href: `/api/calls/${callId.get(c.callNo)}/notices/pdf?lpId=${encodeURIComponent(lpId)}`,
      })),
    ...closings
      .filter((c) => c.finalised && c.result?.lines.some((l) => l.lpId === lpId))
      .map((c) => ({
        date: c.closingDate,
        label: `Closing ${c.closingNo} — equalization statement`,
        href: `/api/funds/${fundId}/closings/${c.id}/statement?lpId=${encodeURIComponent(lpId)}`,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const sideLetters: SideLetterTerm[] = closings
    .flatMap((c) => c.commitments.filter((k) => k.lpId === lpId).map((k) => ({ closingNo: c.closingNo, date: c.closingDate, finalised: c.finalised, amount: k.amount, feeRate: k.feeRateOverride, exempt: k.feeExempt })))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      module="investors"
      callCount={calls.length}
      crumb={{ module: { label: 'Investors', href: `/funds/${fundId}/investors` }, leaf: `${investor.lpId} ${investor.name}` }}
      surface="module"
      askConnected={askStatusForClient().connected}
      gates={fundGates(progress)}
    >
      <InvestorPage
        investor={investor}
        account={account}
        documents={documents}
        sideLetters={sideLetters}
        canWrite={Boolean(canWrite)}
      />
    </AppShell>
  );
}

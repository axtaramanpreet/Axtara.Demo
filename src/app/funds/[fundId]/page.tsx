import Link from 'next/link';
import { notFound } from 'next/navigation';
import { compute, fmt, fmtDate, termsOn } from '@/engine';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import type { CallDefaults, FundTerms } from '@/engine';
import type { CallSummary } from '@/adapters/storage/types';
import { getServerSupabase } from '@/lib/supabase/server';
import { AppShell } from '@/components/shell/app-shell';
import { Card, CardGrid } from '@/components/ui/card';
import { StageTag } from '@/components/ui/tag';
import { DrawdownChart, type DrawdownColumn } from '@/components/home/drawdown-chart';
import { NewCallButton } from './new-call-button';
import { askStatusForClient, noticeDefaults } from '@/lib/env';

/**
 * Home: every capital call for one fund, its position, and how much has been
 * drawn over time.
 *
 * A server component, so the figures are computed where the data is and the
 * browser is never asked to trust numbers it assembled itself.
 */
export default async function FundHomePage({
  params,
}: {
  params: Promise<{ fundId: string }>;
}) {
  const { fundId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [funds, position, calls, terms] = await Promise.all([
    repo.listFunds(),
    repo.getFundPosition(fundId),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
  ]);

  // A new call starts from the deployment's configured signatory and GP, with
  // the fund's terms in force today applied on top.
  const defaults = noticeDefaults();
  const termsToday = termsOn(terms, new Date().toISOString().slice(0, 10));
  const fund = funds.find((c) => c.id === fundId);
  if (!fund) notFound();

  const currency = 'USD';
  const { columns: drawdown, totals: liveTotals } = await buildDrawdown(repo, calls);
  const openCall = calls.find((c) => c.stage === 'in_progress' || c.stage === 'partially_sent');
  const notStarted = calls.find((c) => c.stage === 'not_started');

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      callCount={calls.length}
      crumb={{ leaf: 'Capital calls' }}
      surface="home"
      askConnected={askStatusForClient().connected}
    >
      <>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', maxWidth: 1200 }}>
          <div>
            <h1>{fund.name}</h1>
            <p className="text-muted">{homeHint(calls, openCall)}</p>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <NewCallButton
              fundId={fundId}
              fundName={fund.name}
              defaults={defaults}
              terms={termsToday}
              reuseCallId={notStarted?.id}
            />
          </div>
        </div>

        {calls.length === 0 ? (
          <EmptyState fundId={fundId} fundName={fund.name} defaults={defaults} terms={termsToday} />
        ) : (
          <>
            <CardGrid style={{ marginTop: 24 }}>
              <Card
                title="Capital calls"
                subtitle={`${calls.filter((c) => c.stage === 'issued').length} issued · ${
                  calls.filter((c) => c.stage !== 'issued').length
                } open`}
              >
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Notice date</th>
                        <th style={{ textAlign: 'right' }}>Amount called</th>
                        <th style={{ textAlign: 'right' }}>Notices</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((c) => (
                        <CallRow
                          key={c.id}
                          call={c}
                          fundId={fundId}
                          liveTotal={liveTotals.get(c.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card
                title="Fund position"
                subtitle={openCall ? `before Call No. ${openCall.callNo}` : 'as at the latest call'}
              >
                <dl className="kv" style={{ gridTemplateColumns: '1fr max-content', padding: '14px 16px' }}>
                  <dt>Total commitments</dt>
                  <dd className="num">{fmt(position?.totalCommitments ?? 0)}</dd>

                  <dt>Called to date ({position?.callsIssued ?? 0} calls)</dt>
                  <dd className="num">{fmt(position?.calledToDate ?? 0)}</dd>

                  <dt>Paid-in capital</dt>
                  <dd className="num">{fmt(position?.paidInCapital ?? 0)}</dd>

                  <dt className="total">Unfunded commitment</dt>
                  <dd className="num total">{fmt(position?.unfundedCommitment ?? 0)}</dd>

                  <dt>Investors</dt>
                  <dd className="num">{position?.investors ?? 0}</dd>

                  <dt>Next payment due</dt>
                  <dd style={{ fontSize: 13, textAlign: 'right' }}>
                    {position?.nextPaymentDue ? fmtDate(position.nextPaymentDue) : '—'}
                  </dd>
                </dl>
              </Card>
            </CardGrid>

            {drawdown.length > 0 && (
              <DrawdownChart
                columns={drawdown}
                totalCommitments={position?.totalCommitments ?? 0}
                currency={currency}
              />
            )}
          </>
        )}
      </>
    </AppShell>
  );
}

function CallRow({
  call,
  fundId,
  liveTotal,
}: {
  call: CallSummary;
  fundId: string;
  /** Recomputed total for a call that has no frozen snapshot yet. */
  liveTotal?: number;
}) {
  const href =
    call.stage === 'not_started'
      ? `/funds/${fundId}/calls/${call.id}/setup`
      : `/funds/${fundId}/calls/${call.id}`;

  const action =
    call.stage === 'not_started' ? 'Set up' : call.stage === 'issued' ? 'View' : 'Continue';

  const inProgress = call.stage === 'in_progress' || call.stage === 'partially_sent';

  return (
    <tr style={{ fontWeight: inProgress ? 600 : 400 }}>
      <td className="mono">
        <Link href={href} style={{ textDecoration: 'none' }}>
          {String(call.callNo).padStart(2, '0')}
        </Link>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {call.callDate ? fmtDate(call.callDate) : '—'}
        <div className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
          due {call.paymentDueDate ? fmtDate(call.paymentDueDate) : '—'}
        </div>
      </td>
      {/* An issued call shows what was actually sent; one still being prepared
          shows what it currently comes to, which is the figure the accountant
          is working towards. Only a call with no inputs at all shows nothing. */}
      <td className="num">
        {call.totalCalled !== null
          ? fmt(call.totalCalled)
          : liveTotal !== undefined
            ? fmt(liveTotal)
            : '—'}
      </td>
      <td className="num text-muted">
        {call.activeInvestors === 0 ? '—' : `${call.noticesSent} / ${call.activeInvestors} sent`}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <StageTag stage={call.stage} />
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <Link href={href} className="crumb">
          {action} ›
        </Link>
      </td>
    </tr>
  );
}

function EmptyState({
  fundId,
  fundName,
  defaults,
  terms,
}: {
  fundId: string;
  fundName: string;
  defaults: CallDefaults;
  terms: FundTerms | null;
}) {
  return (
    <Card style={{ maxWidth: 560, marginTop: 24 }} bodyPadding="28px">
      <h3>No capital calls yet</h3>
      <p className="text-muted" style={{ maxWidth: 420 }}>
        Start a call by uploading the accountant&rsquo;s input workbook, entering the register by
        hand, or loading the illustrative template to see how it works.
      </p>
      <div style={{ marginTop: 18 }}>
        <NewCallButton fundId={fundId} fundName={fundName} defaults={defaults} terms={terms} />
      </div>
    </Card>
  );
}

/** The one-line hint under the fund name. */
function homeHint(calls: CallSummary[], openCall?: CallSummary): string {
  if (!calls.length) return 'No calls yet.';
  if (openCall) {
    return `Call No. ${openCall.callNo} is in progress — open it to continue, or start a new call.`;
  }
  if (calls.every((c) => c.stage === 'issued')) {
    return `All ${calls.length} calls issued. Start a new call when the next drawdown is ready.`;
  }
  return 'Pick up where you left off, or start a new call.';
}

/**
 * Column data for the drawdown chart.
 *
 * Issued calls carry a frozen snapshot, so their figures are read back exactly
 * as they were sent. A call still in progress has no snapshot by design, so it
 * is recomputed here — and one that has no inputs yet is drawn as a planned
 * outline rather than a zero-height bar.
 */
async function buildDrawdown(
  repo: ReturnType<typeof createSupabaseRepository>,
  calls: CallSummary[],
): Promise<{ columns: DrawdownColumn[]; totals: Map<string, number> }> {
  const ordered = [...calls].sort((a, b) => a.callNo - b.callNo);
  const columns: DrawdownColumn[] = [];
  const totals = new Map<string, number>();
  let cumulative = 0;
  let commitments = 0;

  // Every call is loaded at once rather than one after another. Each getCall is
  // two round trips to the database, and awaited inside the loop they queued up:
  // a fund with ten calls waited on twenty trips in a row before Home drew.
  const details = new Map(
    await Promise.all(
      ordered
        .filter((c) => c.stage !== 'not_started')
        .map(async (c) => [c.id, await repo.getCall(c.id)] as const),
    ),
  );

  for (const call of ordered) {
    if (call.stage === 'not_started') {
      columns.push({
        callNo: call.callNo,
        total: null,
        againstCommitment: 0,
        outsideCommitment: 0,
        feeNet: 0,
        cumulativePct: 0,
        planned: true,
      });
      continue;
    }

    const detail = details.get(call.id);
    if (!detail) continue;

    const result = compute(detail.model);
    const feeNet = result.totals.feeNet;
    const feeInside = result.fee.reduces;

    // The three segments must add back to the total called.
    const againstCommitment = result.totals.reduces - (feeInside ? feeNet : 0);
    const outsideCommitment = result.totals.total - result.totals.reduces - (feeInside ? 0 : feeNet);

    cumulative += result.totals.total;
    commitments = result.totals.Commitment || commitments;
    totals.set(call.id, result.totals.total);

    columns.push({
      callNo: call.callNo,
      total: result.totals.total,
      againstCommitment,
      outsideCommitment,
      feeNet,
      cumulativePct: commitments > 0 ? (cumulative / commitments) * 100 : 0,
      planned: false,
    });
  }

  return { columns, totals };
}

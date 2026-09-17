import Link from 'next/link';
import { notFound } from 'next/navigation';
import { compute, fmt, fmtDate } from '@/engine';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import type { CallSummary } from '@/adapters/storage/types';
import { getServerSupabase } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { Card, CardGrid } from '@/components/ui/card';
import { StageTag } from '@/components/ui/tag';
import { DrawdownChart, type DrawdownColumn } from '@/components/home/drawdown-chart';
import { NewCallButton } from './new-call-button';

/**
 * Home: every capital call for one fund, its position, and how much has been
 * drawn over time.
 *
 * A server component, so the figures are computed where the data is and the
 * browser is never asked to trust numbers it assembled itself.
 */
export default async function ClientHomePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [clients, position, calls] = await Promise.all([
    repo.listClients(),
    repo.getClientPosition(clientId),
    repo.listCalls(clientId),
  ]);

  const client = clients.find((c) => c.id === clientId);
  if (!client) notFound();

  const currency = 'USD';
  const { columns: drawdown, totals: liveTotals } = await buildDrawdown(repo, calls);
  const openCall = calls.find((c) => c.stage === 'in_progress' || c.stage === 'partially_sent');
  const notStarted = calls.find((c) => c.stage === 'not_started');

  return (
    <div className="app">
      <AppHeader clients={clients} currentClientId={clientId} />

      <main style={{ padding: '28px 40px 60px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', maxWidth: 1200 }}>
          <div>
            <h1>{client.name}</h1>
            <p className="text-muted">{homeHint(calls, openCall)}</p>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <NewCallButton clientId={clientId} reuseCallId={notStarted?.id} />
          </div>
        </div>

        {calls.length === 0 ? (
          <EmptyState clientId={clientId} />
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
                          clientId={clientId}
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
      </main>
    </div>
  );
}

function CallRow({
  call,
  clientId,
  liveTotal,
}: {
  call: CallSummary;
  clientId: string;
  /** Recomputed total for a call that has no frozen snapshot yet. */
  liveTotal?: number;
}) {
  const href =
    call.stage === 'not_started'
      ? `/clients/${clientId}/calls/${call.id}/setup`
      : `/clients/${clientId}/calls/${call.id}`;

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

function EmptyState({ clientId }: { clientId: string }) {
  return (
    <Card style={{ maxWidth: 560, marginTop: 24 }} bodyPadding="28px">
      <h3>No capital calls yet</h3>
      <p className="text-muted" style={{ maxWidth: 420 }}>
        Start a call by uploading the accountant&rsquo;s input workbook, entering the register by
        hand, or loading the illustrative template to see how it works.
      </p>
      <div style={{ marginTop: 18 }}>
        <NewCallButton clientId={clientId} />
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

    const detail = await repo.getCall(call.id);
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { compute, fmt, fmtDate, positionFromRecord, termsOn } from '@/engine';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import type { CallSummary } from '@/adapters/storage/types';
import { getServerSupabase } from '@/lib/supabase/server';
import { AppShell } from '@/components/shell/app-shell';
import { InfoTip } from '@/components/ui/info-tip';
import { Card, CardGrid } from '@/components/ui/card';
import { StageTag } from '@/components/ui/tag';
import { DrawdownChart, type DrawdownColumn } from '@/components/home/drawdown-chart';
import { FundSetup, setupSteps } from '@/components/home/fund-setup';
import { profileGaps } from '@/lib/investor-profile';
import { NewCallButton } from './new-call-button';
import { askStatusForClient, noticeDefaults } from '@/lib/env';
import { fundGates } from '@/lib/fund-gates';

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

  const [funds, stored, calls, terms, closings, issued, investors, progress] = await Promise.all([
    repo.listFunds(),
    repo.getFundPosition(fundId),
    repo.listCalls(fundId),
    repo.listFundTerms(fundId),
    repo.listClosings(fundId),
    repo.listIssuedCalls(fundId),
    repo.listInvestors(fundId),
    repo.getFundProgress(fundId),
  ]);

  // A fund with closings is read from its record — every issued call and
  // closing — the same way Closings and a new call's register read it. Any
  // other fund keeps the stored view: its latest call's register.
  const today = new Date().toISOString().slice(0, 10);
  const fromRecord = positionFromRecord({ terms, closings, calls: issued }, today);
  const position = stored && { ...stored, ...fromRecord };

  // A new call starts from the deployment's configured signatory and GP, with
  // the fund's terms in force today applied on top.
  const defaults = noticeDefaults();
  const termsToday = termsOn(terms, today);
  const fund = funds.find((c) => c.id === fundId);
  if (!fund) notFound();

  const currency = 'USD';
  const { columns: drawdown, totals: liveTotals } = await buildDrawdown(repo, calls, fundId);
  const openCall = calls.find((c) => c.stage === 'in_progress' || c.stage === 'partially_sent');
  const gates = fundGates(progress);
  // A fund opens on its setup checklist until its first call is issued.
  const settingUp = !calls.some((c) => c.lockedAt);
  const notStarted = calls.find((c) => c.stage === 'not_started');

  return (
    <AppShell
      funds={funds}
      fundId={fundId}
      callCount={calls.length}
      crumb={{ leaf: 'Capital calls' }}
      surface="home"
      askConnected={askStatusForClient().connected}
      gates={gates}
    >
      <>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', maxWidth: 1200 }}>
          <div>
            <h1>{fund.name}</h1>
            <p className="text-muted">
              {settingUp ? 'Four steps to the first call: the terms, the investors, the first close, then the call itself.' : homeHint(calls, openCall)}
            </p>
          </div>
          {/* While the fund is being set up, the checklist carries this action
              as its third step, so the header does not pull it out of order. */}
          {!settingUp && (
            <div style={{ marginLeft: 'auto' }}>
              <NewCallButton
                fundId={fundId}
                fundName={fund.name}
                defaults={defaults}
                terms={termsToday}
                reuseCallId={notStarted?.id}
              />
            </div>
          )}
        </div>

        {settingUp && (
          <FundSetup
            fundId={fundId}
            fundName={fund.name}
            steps={setupSteps(terms, { count: investors.length, incomplete: investors.filter((i) => profileGaps(i).length).length }, closings, calls)}
            defaults={defaults}
            termsToday={termsToday}
            gates={gates}
          />
        )}

        {calls.length > 0 && (
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
                subtitle={openCall ? `before Call No. ${openCall.callNo}` : fromRecord ? 'after every issued call and closing' : 'as at the latest call'}
              >
                <dl className="kv" style={{ gridTemplateColumns: '1fr max-content', padding: '14px 16px' }}>
                  <dt>Total commitments</dt>
                  <dd className="num">{fmt(position?.totalCommitments ?? 0)}</dd>

                  <dt>Called to date ({position?.callsIssued ?? 0} calls)</dt>
                  <dd className="num">{fmt(position?.calledToDate ?? 0)}</dd>

                  <dt>
                    Paid-in capital{' '}
                    <InfoTip label="Paid-in capital">
                      Everything investors have paid in: each call, plus what late investors paid at a later closing
                      (their catch-up fee — the capital that moved between investors nets to nothing), plus any
                      balances brought in from before the fund was on Axtara.
                    </InfoTip>
                  </dt>
                  <dd className="num">{fmt(position?.paidInCapital ?? 0)}</dd>
                  {position && Math.abs(position.paidInCapital - position.calledToDate) >= 0.005 && (
                    <>
                      <dt className="text-muted" style={{ fontSize: 12, paddingLeft: 12 }}>
                        of which beyond the calls: later closings and balances brought in
                      </dt>
                      <dd className="num text-muted" style={{ fontSize: 12 }}>
                        {fmt(position.paidInCapital - position.calledToDate)}
                      </dd>
                    </>
                  )}

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

/** The one-line hint under the fund name. */
function homeHint(calls: CallSummary[], openCall?: CallSummary): string {
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
 * Every call is worked out from its inputs, which a sent call can no longer
 * change. Only calls that have gone out count as called: a draft is drawn as a
 * dashed outline at its size, and one with nothing entered yet as an empty one.
 */
async function buildDrawdown(
  repo: ReturnType<typeof createSupabaseRepository>,
  calls: CallSummary[],
  fundId: string,
): Promise<{ columns: DrawdownColumn[]; totals: Map<string, number> }> {
  const ordered = [...calls].sort((a, b) => a.callNo - b.callNo);
  const columns: DrawdownColumn[] = [];
  const totals = new Map<string, number>();
  let cumulative = 0;

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
        callDate: call.callDate,
        href: `/funds/${fundId}/calls/${call.id}/setup`,
        total: null,
        againstCommitment: 0,
        outsideCommitment: 0,
        feeNet: 0,
        cumulative,
        draft: true,
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

    // Only what has gone out is called. A draft is shown at its size, but
    // nothing is called until its first notice is sent, which also locks it.
    const draft = call.stage === 'in_progress';
    if (!draft) cumulative += result.totals.total;
    totals.set(call.id, result.totals.total);

    columns.push({
      callNo: call.callNo,
      callDate: call.callDate,
      href: `/funds/${fundId}/calls/${call.id}${draft ? '/setup' : ''}`,
      total: result.totals.total,
      againstCommitment,
      outsideCommitment,
      feeNet,
      cumulative,
      draft,
    });
  }

  return { columns, totals };
}

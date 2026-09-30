'use client';

import { useState } from 'react';
import {
  STATEMENT_DAYS_TO_PAY,
  equalizationForStatement,
  fmt,
  fmtDate,
  fmtStamp,
  interestRunsToDueDate,
  suggestedStatementDueDate,
  type EqualizationResult,
} from '@/engine';
import type { ClosingStatement } from '@/adapters/storage/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tag } from '@/components/ui/tag';

/**
 * A closing settled now: one statement for each investor its equalization
 * moves money for, approved and then sent, as call notices are.
 *
 * Approving says the date they are payable by — suggested as ten working days
 * after the closing — and, when the terms run interest to when investors pay,
 * the amounts follow it. One date for the whole closing: it can change until
 * the first statement is sent, and then it is fixed.
 *
 * The browser only says what to do; the server works out every figure from
 * the frozen equalization, and nothing is sent without a confirmation that
 * says how much is being asked for.
 */
export function StatementsCard({
  fundId,
  closingId,
  closingNo,
  result,
  statements,
  canWrite,
  statementHref,
  onChanged,
}: {
  fundId: string;
  closingId: string;
  closingNo: number;
  result: EqualizationResult;
  statements: ClosingStatement[];
  canWrite: boolean;
  statementHref: (lpId: string) => string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'approve' | 'send' | 'retry' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  // Fixed once one is sent; until then, what the approved ones say, or a suggestion.
  const anySent = statements.some((s) => s.status === 'sent');
  const fixedDate = anySent ? (statements.find((s) => s.status === 'sent' && s.paymentDueDate)?.paymentDueDate ?? null) : null;
  const approvedDate = statements.find((s) => s.status === 'approved' && s.paymentDueDate)?.paymentDueDate ?? null;
  const [dueDate, setDueDate] = useState(fixedDate ?? approvedDate ?? suggestedStatementDueDate(result.closingDate));
  const toDue = interestRunsToDueDate(result);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate >= result.closingDate;
  // The date the amounts run to: the sent one, or the one picked. A closing
  // whose statements went out before dates were recorded has none.
  const effectiveDate = anySent ? fixedDate : validDate ? dueDate : null;
  const asked = effectiveDate ? equalizationForStatement(result, effectiveDate) : result;
  const netOf = new Map(asked.lines.map((l) => [l.lpId, l.net]));

  const lines = result.lines.filter((l) => l.net !== 0).map((l) => ({ ...l, net: netOf.get(l.lpId) ?? l.net }));
  const byLp = new Map(statements.map((s) => [s.lpId, s]));
  const status = (lpId: string) => byLp.get(lpId)?.status ?? 'draft';
  const drafts = lines.filter((l) => status(l.lpId) === 'draft');
  const approved = lines.filter((l) => status(l.lpId) === 'approved');
  const sent = lines.filter((l) => status(l.lpId) === 'sent');
  const failed = sent.filter((l) => byLp.get(l.lpId)?.emailStatus === 'failed');
  // Approved for another date than the one now picked: approving again moves them to it.
  const redate = !anySent && validDate && approvedDate !== null && approvedDate !== dueDate ? approved.length : 0;
  const owedIn = approved.filter((l) => l.net > 0).reduce((t, l) => t + l.net, 0);
  const returned = approved.filter((l) => l.net < 0).reduce((t, l) => t - l.net, 0);

  async function act(action: 'approve' | 'send' | 'retry') {
    setConfirming(false);
    setBusy(action);
    setError(null);
    setSaid(null);
    try {
      const res = await fetch(`/api/funds/${fundId}/closings/${closingId}/statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action, paymentDueDate: effectiveDate } : { action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Nothing was done.');
      if (action === 'approve') setSaid(`${body.approved} approved${body.redated ? `, ${body.redated} moved to the new date` : ''}.`);
      else setSaid(`${action === 'send' ? `${body.sent} sent. ` : ''}${body.delivered} emailed${body.failed ? `, ${body.failed} failed: ${body.errors.join(' ')}` : ''}.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was done.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Statements" subtitle={`${sent.length} of ${lines.length} sent`}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Investor</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const s = byLp.get(l.lpId);
              return (
                <tr key={l.lpId}>
                  <td>
                    <span className="mono">{l.lpId}</span> {l.name}
                  </td>
                  <td className="num">{l.net > 0 ? `pays ${fmt(l.net)}` : `receives ${fmt(-l.net)}`}</td>
                  <td>
                    {s?.status === 'sent' ? (
                      <>
                        <Tag tone="accent">Sent</Tag>{' '}
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {fmtStamp(s.sentAt!)}
                          {s.emailStatus === 'delivered' && ` · emailed to ${s.emailDeliveredTo}`}
                          {s.emailStatus === 'failed' && ` · email failed: ${s.emailError}`}
                        </span>
                      </>
                    ) : s?.status === 'approved' ? (
                      <Tag tone="neutral">Approved</Tag>
                    ) : (
                      <Tag tone="warn">Draft</Tag>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <a href={statementHref(l.lpId)} className="crumb">
                      PDF
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px 0' }}>
        {anySent || !canWrite ? (
          <span style={{ fontSize: 13 }}>
            Payable by <strong>{effectiveDate ? fmtDate(effectiveDate) : 'no date recorded'}</strong>
          </span>
        ) : (
          <label style={{ fontSize: 13 }}>
            Payable by{' '}
            <input
              className="cell"
              type="date"
              value={dueDate}
              min={result.closingDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ width: 160, border: '1px solid var(--border)' }}
            />
          </label>
        )}
        <span className="text-muted" style={{ fontSize: 12 }}>
          {anySent
            ? fixedDate
              ? 'Fixed when the first statement was sent; every statement for this closing uses it.'
              : 'Its statements were sent before a payment date was recorded, so the rest cannot be given one.'
            : approvedDate
              ? 'One date for every statement of this closing. It can change until the first is sent.'
              : `Suggested: ${STATEMENT_DAYS_TO_PAY} working days after the closing. Check it against holidays.`}
          {toDue && ' Interest runs to this date, so the amounts follow it.'}
          {!anySent && !validDate && ` Pick a date on or after ${fmtDate(result.closingDate)}.`}
        </span>
      </div>
      {canWrite && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px' }}>
          {drafts.length > 0 || !redate ? (
            <Button small onClick={() => act('approve')} loading={busy === 'approve'} disabled={busy !== null || !drafts.length || !effectiveDate}>
              Approve {drafts.length ? `${drafts.length} ` : ''}statement{drafts.length === 1 ? '' : 's'}
              {redate ? `, and move ${redate} approved to this date` : ''}
            </Button>
          ) : (
            <Button small onClick={() => act('approve')} loading={busy === 'approve'} disabled={busy !== null}>
              Move {redate} approved to {fmtDate(dueDate)}
            </Button>
          )}
          <Button small variant="primary" onClick={() => setConfirming(true)} loading={busy === 'send'} disabled={busy !== null || !approved.length}>
            Send {approved.length ? `${approved.length} ` : ''}approved
          </Button>
          {failed.length > 0 && (
            <Button small onClick={() => act('retry')} loading={busy === 'retry'} disabled={busy !== null}>
              Email {failed.length} again
            </Button>
          )}
        </div>
      )}
      {said && (
        <p role="status" style={{ fontSize: 13, padding: '0 16px 12px', margin: 0 }}>
          {said}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, padding: '0 16px 12px', margin: 0 }}>
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Send ${approved.length} statement${approved.length === 1 ? '' : 's'} for Closing ${closingNo}?`}
          confirm={`Send ${approved.length} statement${approved.length === 1 ? '' : 's'}`}
          busy={busy === 'send'}
          onConfirm={() => act('send')}
          onCancel={() => setConfirming(false)}
        >
          <p style={{ margin: 0 }}>
            Asks for {fmt(owedIn)} from late investors{effectiveDate ? ` by ${fmtDate(effectiveDate)}` : ''}
            {returned ? `, and tells earlier investors ${fmt(returned)} comes back to them` : ''}.
          </p>
          <p className="text-muted" style={{ margin: 0 }}>
            Each is fixed as sent and emailed with its PDF. After this, how Closing {closingNo} is settled cannot change.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

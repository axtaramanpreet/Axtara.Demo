'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buildNotice, type ComputeResult } from '@/engine';
import type { CallDetail } from '@/adapters/storage/types';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { NOTICE_DISPLAY, noticeFor, noticeStatusFor } from './notice-status';
import { NoticeSheet } from './notice-sheet';

/**
 * Notices: review, approve, send.
 *
 * The three states are kept deliberately distinct. A draft is being checked; an
 * approved notice has had a person take responsibility for its figures; a sent
 * one has reached an investor and can no longer be altered. Every button here
 * goes through the server, which re-runs the checks before allowing anything.
 */
export function NoticesTab({
  call,
  result,
  selectedLp,
  onSelect,
}: {
  call: CallDetail;
  result: ComputeResult;
  selectedLp?: string;
  onSelect: (lpId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const active = result.rows.filter((r) => r.isActive);
  const selected = active.find((r) => r.LP_ID === selectedLp) ?? active[0];

  const failing = result.checks.filter((c) => c.level === 'fail').length;
  const statuses = active.map((r) => noticeStatusFor(call.notices, r.LP_ID));
  const sent = statuses.filter((s) => s === 'sent').length;
  const approved = statuses.filter((s) => s === 'approved').length;
  const draft = statuses.filter((s) => s === 'draft').length;

  async function act(action: 'approve' | 'revert' | 'send', lpIds?: string[]) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/calls/${call.id}/notices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lpIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'That did not work.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (!active.length) {
    return (
      <p className="text-muted" style={{ marginTop: 20 }}>
        There are no active investors on this call, so there is nothing to issue.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div
        data-noprint="1"
        style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}
      >
        <Button variant="secondary" onClick={() => window.print()}>
          Print / save PDF
        </Button>
        <Button variant="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show one investor' : `Show all ${active.length} notices`}
        </Button>

        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {sent} sent · {approved} approved · {draft} draft
        </span>

        <Button
          variant="secondary"
          disabled={busy || draft === 0 || failing > 0}
          onClick={() => act('approve')}
          title={failing > 0 ? 'Resolve the failing checks first' : undefined}
        >
          Approve all drafts
        </Button>
        <Button
          variant="primary"
          disabled={busy || approved === 0}
          onClick={() => act('send')}
        >
          Send all approved
        </Button>
      </div>

      {failing > 0 && (
        <p data-noprint="1" style={{ color: 'var(--destructive)', fontSize: 13, marginTop: 0 }}>
          {failing} check{failing === 1 ? ' is' : 's are'} failing. Approval is disabled until they
          are resolved.
        </p>
      )}

      {error && (
        <p data-noprint="1" role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <nav
          data-noprint="1"
          aria-label="Investors"
          style={{ width: 220, flex: 'none', display: 'grid', gap: 2 }}
        >
          {active.map((row) => {
            const status = noticeStatusFor(call.notices, row.LP_ID);
            return (
              <button
                key={row.LP_ID}
                type="button"
                onClick={() => onSelect(row.LP_ID)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  textAlign: 'left',
                  background:
                    !showAll && selected?.LP_ID === row.LP_ID ? 'var(--muted)' : 'transparent',
                  color: 'var(--foreground)',
                }}
              >
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {row.LP_Name}
                </span>
                <Tag tone={NOTICE_DISPLAY[status].tone}>{NOTICE_DISPLAY[status].label}</Tag>
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 24 }}>
          {(showAll ? active : selected ? [selected] : []).map((row) => {
            const status = noticeStatusFor(call.notices, row.LP_ID);
            const record = noticeFor(call.notices, row.LP_ID);
            const email = (row.Contact_Email as string) || '';

            return (
              <div key={row.LP_ID}>
                <div
                  data-noprint="1"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    marginBottom: 10,
                    fontSize: 13,
                  }}
                >
                  <Tag tone={NOTICE_DISPLAY[status].tone}>{NOTICE_DISPLAY[status].label}</Tag>
                  <span className="text-muted">
                    {status === 'draft' && 'review, then approve'}
                    {status === 'approved' &&
                      `approved${record?.approvedAt ? ` ${new Date(record.approvedAt).toLocaleString('en-GB')}` : ''} — ready to send`}
                    {status === 'sent' &&
                      `sent${record?.sentAt ? ` ${new Date(record.sentAt).toLocaleString('en-GB')}` : ''}${record?.sentToEmail ? ` to ${record.sentToEmail}` : ''}`}
                  </span>

                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {status === 'draft' && (
                      <Button
                        variant="primary"
                        disabled={busy || failing > 0}
                        onClick={() => act('approve', [row.LP_ID])}
                      >
                        Approve
                      </Button>
                    )}
                    {status === 'approved' && (
                      <>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => act('revert', [row.LP_ID])}
                        >
                          Back to draft
                        </Button>
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => act('send', [row.LP_ID])}
                        >
                          Send to {email || row.LP_Name}
                        </Button>
                      </>
                    )}
                    {status === 'sent' && (
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        This notice has been issued and cannot be changed.
                      </span>
                    )}
                  </span>
                </div>

                {status !== 'draft' && !email && (
                  <p data-noprint="1" className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
                    No Contact_Email for {row.LP_ID} — add one in the LP register to email this
                    notice.
                  </p>
                )}

                <NoticeSheet
                  notice={buildNotice(call.model, result, row)}
                  status={status}
                  issuedOn={record?.sentAt}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

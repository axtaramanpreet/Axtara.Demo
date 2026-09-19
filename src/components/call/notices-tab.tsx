'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { buildNotice, type ComputeResult } from '@/engine';
import type { CallDetail } from '@/adapters/storage/types';
import { Check, CheckCheck, FileArchive, FileDown, Printer, Rows3, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem } from '@/components/ui/menu';
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
  email,
  selectedLp,
  onSelect,
}: {
  call: CallDetail;
  result: ComputeResult;
  /** Whether notices can be emailed, and whether they are being redirected. */
  email: { configured: boolean; overrideTo: string | null };
  selectedLp?: string;
  onSelect: (lpId: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  /**
   * Which control was pressed, and whether anything is still in flight.
   *
   * A single `busy` flag disabled every button at once and showed nothing, so
   * a send looked identical to a misclick until the page happened to change.
   *
   * An action spans two waits — the request, then the refresh that shows its
   * result — and React only knows the second has finished when the new UI is
   * ready. Both are tracked as state: the key of the control, and the two
   * transitions. The key is deliberately never cleared; it only means anything
   * while something is running, so a stale one shows nothing.
   */
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);

  const [isRefreshing, startRefresh] = useTransition();
  const [isSwitching, startSwitch] = useTransition();

  const busy = requesting || isRefreshing;
  /** True for the one control that is working. */
  const working = (key: string) => busy && workingKey === key;
  /**
   * The icon for a control, or nothing while it is working.
   *
   * `Button` puts the spinner in front of its children, so a label-free button
   * has to drop its icon or it would show both.
   */
  const icon = (key: string, glyph: ReactNode) => (working(key) ? null : glyph);
  /** The investor being switched to, while the pane is still catching up. */
  const switchingTo = isSwitching ? switchTarget : null;

  /** Switch investors, keeping the clicked row marked until the pane catches up. */
  function select(lpId: string) {
    if (lpId === selectedLp) return;
    setSwitchTarget(lpId);
    startSwitch(() => onSelect(lpId));
  }

  /**
   * Ask the server for the file.
   *
   * A plain link would do, but an error would then arrive as a JSON body the
   * browser saves as a download — so the response is checked first and the
   * message surfaced, and only a real file is handed to the disk.
   */
  async function download(lpId?: string) {
    setError(null);
    setWorkingKey(lpId ? `download:${lpId}` : 'download:all');
    setRequesting(true);
    const query = lpId ? `?lpId=${encodeURIComponent(lpId)}` : '';
    try {
      const response = await fetch(`/api/calls/${call.id}/notices/pdf${query}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'The notices could not be produced.');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // The server names the file; this only has to not override it.
      link.download = fileNameFrom(response.headers.get('Content-Disposition')) ?? '';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('The download could not be started.');
    } finally {
      // Nothing to refresh: a download changes no state on the page.
      setRequesting(false);
    }
  }

  const active = result.rows.filter((r) => r.isActive);
  const selected = active.find((r) => r.LP_ID === selectedLp) ?? active[0];

  const failing = result.checks.filter((c) => c.level === 'fail').length;
  const statuses = active.map((r) => noticeStatusFor(call.notices, r.LP_ID));
  const sent = statuses.filter((s) => s === 'sent').length;
  const approved = statuses.filter((s) => s === 'approved').length;
  const draft = statuses.filter((s) => s === 'draft').length;

  /**
   * What the call needs next.
   *
   * Approving comes before sending, so drafts win while any remain; then the
   * approved ones are waiting to go; then there is nothing left to do. This
   * decides what is *bold* — the other step stays available in the menu, since
   * an accountant may well want to approve a late addition to a call that is
   * already part-approved.
   */
  const next: 'approve' | 'send' | 'done' =
    draft > 0 ? 'approve' : approved > 0 ? 'send' : 'done';

  /** Only the states that exist, so a finished call does not read "0 draft". */
  const counts = [
    draft > 0 ? `${draft} draft` : null,
    approved > 0 ? `${approved} approved` : null,
    sent > 0 ? `${sent} sent` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /**
   * @param key Identifies the control that was pressed, so the spinner appears
   *            on that one rather than on all of them.
   */
  async function act(
    action: 'approve' | 'revert' | 'send',
    lpIds: string[] | undefined,
    key: string,
  ) {
    setWorkingKey(key);
    setRequesting(true);
    setError(null);
    try {
      const response = await fetch(`/api/calls/${call.id}/notices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lpIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'That did not work.');

      // Hand the spinner to the refresh: the server has recorded the change,
      // but the page still shows the old figures until it re-renders.
      startRefresh(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setRequesting(false);
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
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <span className="text-muted" style={{ fontSize: 12 }}>
          {active.length} notice{active.length === 1 ? '' : 's'} · {counts}
          {/* Quiet rather than absent. Whoever operates this has to be able to
              tell whether a send reaches investors; the red banner that used to
              say so was too loud to demo in front of anyone. */}
          {email.overrideTo ? (
            <>
              {' · '}
              <span title={`Notices are redirected to ${email.overrideTo}; no investor is emailed.`}>
                Test mode
              </span>
            </>
          ) : !email.configured ? (
            <>
              {' · '}
              <span title="No email provider is configured; sending records a notice but delivers nothing.">
                No email provider
              </span>
            </>
          ) : null}
        </span>

        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Menu label="Other notice actions">
            <MenuItem
              icon={
                working('download:all') ? (
                  <span className="spinner" aria-hidden />
                ) : (
                  <FileArchive size={15} />
                )
              }
              disabled={working('download:all')}
              onClick={() => download()}
            >
              {working('download:all') ? 'Preparing…' : 'Download all as .zip'}
            </MenuItem>
            <MenuItem icon={<Printer size={15} />} onClick={() => window.print()}>
              Print all
            </MenuItem>
            <MenuItem icon={<Rows3 size={15} />} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show one investor' : `Show all ${active.length} notices`}
            </MenuItem>
            {/* The step that is not currently the primary one stays reachable,
                so an accountant who wants to approve while some are already
                approved is not forced through the toolbar's idea of order. */}
            {next === 'send' && (
              <MenuItem
                icon={<CheckCheck size={15} />}
                disabled={busy || draft === 0 || failing > 0}
                title={failing > 0 ? 'Resolve the failing checks first' : undefined}
                onClick={() => act('approve', undefined, 'bulk:approve')}
              >
                Approve {draft} draft{draft === 1 ? '' : 's'}
              </MenuItem>
            )}
            {next === 'approve' && approved > 0 && (
              <MenuItem
                icon={<Send size={15} />}
                disabled={busy}
                onClick={() => act('send', undefined, 'bulk:send')}
              >
                Send {approved} approved
              </MenuItem>
            )}
          </Menu>

          {/* One bold button, and it is whatever the call actually needs next.
              Sending is irreversible; it should never sit beside Print looking
              equally harmless. */}
          {next === 'approve' && (
            <Button
              variant="primary"
              loading={working('bulk:approve')}
              disabled={busy || draft === 0 || failing > 0}
              title={failing > 0 ? 'Resolve the failing checks first' : undefined}
              onClick={() => act('approve', undefined, 'bulk:approve')}
            >
              {working('bulk:approve') ? null : <CheckCheck size={15} aria-hidden />}
              Approve {draft} draft{draft === 1 ? '' : 's'}
            </Button>
          )}
          {next === 'send' && (
            <Button
              variant="primary"
              loading={working('bulk:send')}
              disabled={busy}
              onClick={() => act('send', undefined, 'bulk:send')}
            >
              {working('bulk:send') ? null : <Send size={15} aria-hidden />}
              Send {approved} notice{approved === 1 ? '' : 's'}
            </Button>
          )}
          {next === 'done' && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              Every notice has been issued.
            </span>
          )}
        </span>
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
          // Wider than the name alone needs, because each row now carries its
          // own approve and undo.
          style={{ width: 268, flex: 'none', display: 'grid', gap: 2 }}
        >
          {active.map((row) => {
            const status = noticeStatusFor(call.notices, row.LP_ID);
            const here = !showAll && selected?.LP_ID === row.LP_ID;

            return (
              // A row, not a button: it holds three controls, and a button
              // inside a button is not valid markup and does not click
              // predictably.
              <div
                key={row.LP_ID}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  paddingRight: 4,
                  borderRadius: 6,
                  background: here ? 'var(--muted)' : 'transparent',
                }}
              >
                <button
                  type="button"
                  onClick={() => select(row.LP_ID)}
                  aria-current={here || undefined}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 4px 8px 10px',
                    borderRadius: 6,
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 13,
                    textAlign: 'left',
                    color: 'var(--foreground)',
                  }}
                >
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {row.LP_Name}
                  </span>
                  {switchingTo === row.LP_ID ? (
                    <span className="spinner text-muted" aria-label="Loading" />
                  ) : (
                    <Tag tone={NOTICE_DISPLAY[status].tone}>{NOTICE_DISPLAY[status].label}</Tag>
                  )}
                </button>

                {/* Both icons are on every row, enabled only where they mean
                    something. Showing and hiding them instead would shift the
                    rows around as a call progresses, and would leave nothing to
                    explain why an investor has no approve on them. */}
                <Button
                  iconOnly
                  small
                  variant="ghost"
                  aria-label={`Approve the notice for ${row.LP_Name}`}
                  title={
                    status !== 'draft'
                      ? status === 'approved'
                        ? 'Already approved'
                        : 'Issued — it cannot be changed'
                      : failing > 0
                        ? 'Resolve the failing checks first'
                        : `Approve the notice for ${row.LP_Name}`
                  }
                  loading={working(`approve:${row.LP_ID}`)}
                  disabled={busy || status !== 'draft' || failing > 0}
                  onClick={() => act('approve', [row.LP_ID], `approve:${row.LP_ID}`)}
                >
                  {icon(`approve:${row.LP_ID}`, <Check size={15} aria-hidden />)}
                </Button>

                <Button
                  iconOnly
                  small
                  variant="ghost"
                  aria-label={`Take the notice for ${row.LP_Name} back to draft`}
                  title={
                    status === 'approved'
                      ? 'Back to draft'
                      : status === 'draft'
                        ? 'Nothing to undo — this is still a draft'
                        : 'Issued — it cannot be taken back'
                  }
                  loading={working(`revert:${row.LP_ID}`)}
                  disabled={busy || status !== 'approved'}
                  onClick={() => act('revert', [row.LP_ID], `revert:${row.LP_ID}`)}
                >
                  {icon(`revert:${row.LP_ID}`, <Undo2 size={15} aria-hidden />)}
                </Button>
              </div>
            );
          })}
        </nav>

        <div
          // Fades rather than blanking: the outgoing notice stays readable, and
          // nothing on the page jumps when the new one arrives.
          className={isSwitching || isRefreshing ? 'is-busy' : undefined}
          aria-busy={isSwitching || isRefreshing || undefined}
          style={{ flex: 1, minWidth: 0, display: 'grid', gap: 24 }}
        >
          {(showAll ? active : selected ? [selected] : []).map((row) => {
            const status = noticeStatusFor(call.notices, row.LP_ID);
            const record = noticeFor(call.notices, row.LP_ID);
            // Named apart from the `email` prop, which is the fund-wide
            // delivery configuration rather than this investor's address.
            const investorEmail = (row.Contact_Email as string) || '';

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
                  {/* The investor's name, because the list beside this shows a
                      different one whenever the selection is further down it —
                      a status tag with no name reads as a contradiction. */}
                  <strong style={{ fontSize: 14 }}>{row.LP_Name}</strong>
                  <Tag tone={NOTICE_DISPLAY[status].tone}>{NOTICE_DISPLAY[status].label}</Tag>
                  <span className="text-muted">
                    {status === 'draft' && 'review, then approve'}
                    {status === 'approved' &&
                      `approved${record?.approvedAt ? ` ${new Date(record.approvedAt).toLocaleString('en-GB')}` : ''} — ready to send`}
                    {status === 'sent' &&
                      `issued${record?.sentAt ? ` ${new Date(record.sentAt).toLocaleString('en-GB')}` : ''} — cannot be changed`}
                  </span>

                  {/* What is left to do with this one notice.
                      Approving and undoing live on the investor's tile in the
                      list, beside the status they change. Sending stays here,
                      because it is irreversible and belongs next to the figures
                      a person is meant to have read before pressing it — and it
                      keeps its word for the same reason. The download is a bare
                      icon: it changes nothing. */}
                  <span
                    style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}
                  >
                    <Button
                      iconOnly
                      small
                      variant="ghost"
                      aria-label={`Download the notice for ${row.LP_Name}`}
                      title="Download this notice as a PDF"
                      loading={working(`download:${row.LP_ID}`)}
                      onClick={() => download(row.LP_ID)}
                    >
                      {icon(`download:${row.LP_ID}`, <FileDown size={15} aria-hidden />)}
                    </Button>

                    {status === 'approved' && (
                      <Button
                        small
                        variant="primary"
                        title={
                          investorEmail
                            ? `Emails the notice to ${investorEmail}`
                            : 'No Contact_Email on the register for this investor'
                        }
                        loading={working(`send:${row.LP_ID}`)}
                        disabled={busy}
                        onClick={() => act('send', [row.LP_ID], `send:${row.LP_ID}`)}
                      >
                        {icon(`send:${row.LP_ID}`, <Send size={14} aria-hidden />)}
                        Send
                      </Button>
                    )}
                  </span>
                </div>

                {record?.delivery === 'failed' && (
                  <p
                    data-noprint="1"
                    role="alert"
                    style={{ color: 'var(--destructive)', fontSize: 12, marginTop: 0 }}
                  >
                    Email not delivered — {record.deliveryError}. The notice itself is issued and
                    its figures are frozen; sending the email again does not reissue it.
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

/**
 * The filename the server chose, out of `Content-Disposition`.
 *
 * Prefers the RFC 5987 `filename*`, which carries the real name — the plain
 * `filename` beside it has had the em dash and anything else non-ASCII
 * replaced, because not every client reads the encoded form.
 */
function fileNameFrom(header: string | null): string | null {
  if (!header) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // A malformed header is not worth failing a download over.
    }
  }

  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : null;
}

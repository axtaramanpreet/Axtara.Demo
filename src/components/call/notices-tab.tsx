'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { buildNotice, fmtStamp, paymentFor, serialToISO, type ComputeResult, type FundTerms } from '@/engine';
import type { CallDetail } from '@/adapters/storage/types';
import { Check, CheckCheck, FileArchive, FileDown, Printer, Rows3, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem } from '@/components/ui/menu';
import { Tag } from '@/components/ui/tag';
import { NOTICE_DISPLAY, noticeFor, noticeStatusFor } from './notice-status';
import { NOTICE_MARGIN, NOTICE_WIDTH, NoticeSheet } from './notice-sheet';

/**
 * Wide enough for "Approved", the longest of the three.
 *
 * The tags used to sit hard against the right of each tile, so a long label
 * pushed its dot left and the column zig-zagged down the list. A fixed cell
 * starts every one of them at the same place.
 */
export const STATUS_COLUMN = 76;

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
  fundTerms = [],
}: {
  call: CallDetail;
  result: ComputeResult;
  /** Whether notices can be emailed, and whether they are being redirected. */
  email: { configured: boolean; overrideTo: string | null };
  /** The fund's terms, for the payment instructions a notice carries. */
  fundTerms?: FundTerms[];
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
  // Still to go out, and nowhere to send it. Under the test redirect every
  // notice goes to one address, so nobody is unreachable.
  const unreachable = email.overrideTo
    ? []
    : active.filter((r, i) => statuses[i] !== 'sent' && !String(r.Contact_Email ?? '').trim()).map((r) => r.LP_ID);

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

          {/* The selected notice on its own, beside the actions for all of
              them. It used to hover above the page, the only control there and
              belonging to nothing. In "show all" there is no one notice it
              could mean, so only the menu's zip is offered. */}
          {!showAll && selected && (
            <Button
              iconOnly
              aria-label={`Download the notice for ${selected.LP_Name}`}
              title={`Download the notice for ${selected.LP_Name} as a PDF`}
              loading={working(`download:${selected.LP_ID}`)}
              onClick={() => download(selected.LP_ID)}
            >
              {icon(`download:${selected.LP_ID}`, <FileDown size={16} aria-hidden />)}
            </Button>
          )}

          {/* Sending the one notice on screen. It used to hover over the top of
              the page, which is what made it look like it belonged to nothing.
              It is not the bold button: the call-wide step is. */}
          {!showAll && selected && noticeStatusFor(call.notices, selected.LP_ID) === 'approved' && (
            <Button
              title={
                (selected.Contact_Email as string)
                  ? `Emails the notice to ${selected.Contact_Email}`
                  : 'No Contact_Email on the register for this investor'
              }
              loading={working(`send:${selected.LP_ID}`)}
              disabled={busy}
              onClick={() => act('send', [selected.LP_ID], `send:${selected.LP_ID}`)}
            >
              {icon(`send:${selected.LP_ID}`, <Send size={15} aria-hidden />)}
              Send this notice
            </Button>
          )}

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

      {/* Before anything goes out, not after: an investor with no notices email
          is issued a notice nobody delivers. */}
      {unreachable.length > 0 && (
        <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, margin: '0 0 12px' }}>
          <Tag tone="warn">No notices email</Tag>
          <span style={{ textWrap: 'pretty' }}>
            {unreachable.join(', ')} {unreachable.length === 1 ? 'has' : 'have'} no address to send to, so {unreachable.length === 1 ? 'its notice' : 'their notices'} would be
            issued but not emailed. Add the address on{' '}
            <Link href={`/funds/${call.fundId}/investors`}>Investors</Link> first.
          </span>
        </p>
      )}

      {error && (
        <p data-noprint="1" role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>
          {error}
        </p>
      )}

      <div className="notice-layout">
        {/* Width and the narrow-screen stacking live in the stylesheet, because
            a media query cannot be written inline. Wide enough for a long name,
            its status and both its actions: too narrow and every name
            truncates, and the row cannot grow past it because a row that
            overflows slides under the notice beside it. */}
        <nav data-noprint="1" aria-label="Investors" className="notice-rail">
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
                  // A grid item will not shrink below its content unless told
                  // to. Without this the row stayed as wide as the name plus
                  // the status plus both icons — wider than the list — and the
                  // overflow slid under the notice beside it, which painted
                  // over the last icon and swallowed every click on it.
                  minWidth: 0,
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
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.LP_Name}
                  </span>
                  <span
                    style={{
                      flex: 'none',
                      width: STATUS_COLUMN,
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {switchingTo === row.LP_ID ? (
                      <span className="spinner text-muted" aria-label="Loading" />
                    ) : (
                      <Tag tone={NOTICE_DISPLAY[status].tone}>{NOTICE_DISPLAY[status].label}</Tag>
                    )}
                  </span>
                </button>

                {/* Each action keeps its place in the row whether or not it
                    applies, so the column does not move as a call progresses.
                    The slot is left empty rather than filled with a greyed-out
                    icon: a dead control reads as a broken one, and someone will
                    click it and conclude the screen does not work. */}
                <span className="slot">
                  {status === 'draft' && (
                    <Button
                      iconOnly
                      small
                      variant="ghost"
                      aria-label={`Approve the notice for ${row.LP_Name}`}
                      title={
                        failing > 0
                          ? 'Resolve the failing checks first'
                          : `Approve the notice for ${row.LP_Name}`
                      }
                      loading={working(`approve:${row.LP_ID}`)}
                      disabled={busy || failing > 0}
                      onClick={() => act('approve', [row.LP_ID], `approve:${row.LP_ID}`)}
                    >
                      {icon(`approve:${row.LP_ID}`, <Check size={15} aria-hidden />)}
                    </Button>
                  )}
                </span>

                <span className="slot">
                  {status === 'approved' && (
                    <Button
                      iconOnly
                      small
                      variant="ghost"
                      aria-label={`Take the notice for ${row.LP_Name} back to draft`}
                      title="Back to draft"
                      loading={working(`revert:${row.LP_ID}`)}
                      disabled={busy}
                      onClick={() => act('revert', [row.LP_ID], `revert:${row.LP_ID}`)}
                    >
                      {icon(`revert:${row.LP_ID}`, <Undo2 size={15} aria-hidden />)}
                    </Button>
                  )}
                </span>
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

            return (
              <div key={row.LP_ID}>
                <div
                  data-noprint="1"
                  // The document's own column, so the investor's name starts
                  // where the letter starts and the buttons finish where it
                  // finishes. Full width before, this ran out past the page on
                  // both sides and read as belonging to nothing.
                  style={{
                    maxWidth: NOTICE_WIDTH,
                    margin: '0 auto 10px',
                    padding: `0 ${NOTICE_MARGIN}px`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
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
                      `approved${record?.approvedAt ? ` ${fmtStamp(record.approvedAt)}` : ''} — ready to send`}
                    {status === 'sent' &&
                      `issued${record?.sentAt ? ` ${fmtStamp(record.sentAt)}` : ''} — cannot be changed`}
                  </span>

                  {/* Nothing to press here. Every action on a notice is
                      either on the investor's tile or in the toolbar; this line
                      says which notice is on screen and where it has got to. */}
                </div>

                {record?.delivery === 'failed' && (
                  <p
                    data-noprint="1"
                    role="alert"
                    style={{
                      maxWidth: NOTICE_WIDTH,
                      margin: '0 auto 10px',
                      padding: `0 ${NOTICE_MARGIN}px`,
                      color: 'var(--destructive)',
                      fontSize: 12,
                    }}
                  >
                    Email not delivered — {record.deliveryError}. The notice itself is issued and
                    its figures are frozen; sending the email again does not reissue it.
                  </p>
                )}

                <NoticeSheet
                  notice={buildNotice(call.model, result, row, {
                    payment: paymentFor(fundTerms, serialToISO(call.model.setup.Call_Date), row.LP_ID, call.callNo),
                  })}
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

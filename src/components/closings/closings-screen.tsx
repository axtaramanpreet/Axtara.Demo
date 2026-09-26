'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { Closing, ClosingCommitmentInput, ClosingStatement, FundInvestor } from '@/adapters/storage/types';
import { fmt, fmtDate, pct, type EqualizationResult, type Position, type Settlement } from '@/engine';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InfoTip } from '@/components/ui/info-tip';
import { Tag } from '@/components/ui/tag';
import { EqualizationPanel } from './equalization-panel';
import { SettlementCard, SettlementOptions } from './settlement-choice';
import { StatementsCard } from './statements-card';
import { TemplateButtons } from '@/components/ui/template-buttons';
import { COMMITMENTS_SHEET, commitmentsTemplate, readCommitmentsTemplate, type WorkbookWriter } from '@/adapters/workbook/templates';
import { FIELD, fromDraft, toDraft } from '@/lib/fund-terms-fields';
import { profileGaps } from '@/lib/investor-profile';
import { useLeaveGuard } from '@/lib/hooks/use-leave-guard';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/** A side-letter rate the way the rest of the app takes one: 1.5% or 0.015. */
const RATE = FIELD.feeRateAnnual;
const rateOf = (text: string): number | null => {
  const r = fromDraft(RATE, text);
  return 'value' in r ? (r.value as number | null) : null;
};

/**
 * A fund's closings, in order: who each admitted, and for every later close,
 * the equalization that brings its investors level with those already in.
 *
 * A draft closing is the accountant's to shape. Finalising it is the server's
 * act: the equalization is recomputed from the record, checked, and frozen,
 * and nothing about the closing changes after.
 */
export function ClosingsScreen({
  fundId,
  fundName,
  closings,
  previews,
  settledOn,
  statements,
  positions,
  investors,
  registerSeed,
  canWrite,
  today,
}: {
  fundId: string;
  fundName: string;
  closings: Closing[];
  /** Each later closing's equalization: frozen if finalised, a preview if not. */
  previews: Record<string, EqualizationResult | null>;
  /** The sent calls that settled each closing's equalization, by closing id. */
  settledOn: Record<string, number[]>;
  /** Equalization statements approved or sent, for every closing. */
  statements: ClosingStatement[];
  /** Where every investor stands today. */
  positions: Position[];
  investors: FundInvestor[];
  /** The latest call's register, to start a first close from, for a fund with none. */
  registerSeed: { callNo: number; rows: ClosingCommitmentInput[] } | null;
  canWrite: boolean;
  today: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [newDate, setNewDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = () => createSupabaseRepository(createBrowserSupabase());
  const refresh = () => startRefresh(() => router.refresh());

  const committed = positions.reduce((s, p) => s + p.commitment, 0);
  const paid = positions.reduce((s, p) => s + p.paidIn, 0);
  const openDraft = closings.find((c) => !c.finalised);

  // Rows a new draft starts with, on screen and unsaved: who commits is the
  // person's to check and Save, not something drafting decides for them.
  const [seeded, setSeeded] = useState<{ closingId: string; rows: Row[] } | null>(null);

  async function draft(seed?: ClosingCommitmentInput[]) {
    setBusy(true);
    setError(null);
    try {
      const created = await repo().createClosing(fundId, newDate);
      if (seed?.length) {
        setSeeded({
          closingId: created.id,
          rows: seed.map((k) => ({
            lpId: k.lpId,
            name: k.name,
            amount: k.amount ? String(k.amount) : '',
            feeRateOverride: toDraft(RATE, k.feeRateOverride ?? null),
            feeExempt: Boolean(k.feeExempt),
            contactEmail: k.contactEmail ?? '',
          })),
        });
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft the closing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200, opacity: refreshing ? 0.6 : 1, transition: 'opacity 120ms' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1>Closings</h1>
          <p className="text-muted" style={{ maxWidth: 640, textWrap: 'pretty' }}>
            {closings.length
              ? [
                  `${closings.filter((c) => c.finalised).length} of ${closings.length} finalised`,
                  positions.length ? `${positions.length} investors · ${fmt(committed)} committed` : '',
                  committed ? `${pct(paid / committed)} paid in` : '',
                  openDraft
                    ? `draft closing ${openDraft.closingNo}: ${openDraft.commitments.length} investor${openDraft.commitments.length === 1 ? '' : 's'}, ${fmt(openDraft.commitments.reduce((t, k) => t + k.amount, 0))}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Who the fund admitted, and when. A later close brings its investors level with those already in.'}
          </p>
        </div>
        {canWrite && !openDraft && closings.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="cell"
              type="date"
              aria-label="Date of the next closing"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              style={{ width: 160, border: '1px solid var(--border)' }}
            />
            <Button variant="primary" onClick={() => draft()} loading={busy}>
              Draft closing {closings.length + 1}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>
          {error}
        </p>
      )}

      {closings.length === 0 && (
        <Card style={{ marginTop: 24, maxWidth: 680 }} bodyPadding="24px">
          <h3 style={{ marginTop: 0 }}>No closings recorded</h3>
          <p className="text-muted" style={{ textWrap: 'pretty' }}>
            The first close admits the fund&rsquo;s first investors. Later closes admit more, and
            each is equalized: late investors pay their share of what was called before they
            joined, with interest and the fee they missed, and the investors who paid first get it
            back.
          </p>
          {canWrite && (
            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>Date of the first close</span>
                <input
                  className="cell bordered"
                  type="date"
                  aria-label="Date of the first close"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  style={{ width: 170 }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {registerSeed ? (
                  <Button variant="primary" onClick={() => draft(registerSeed.rows)} loading={busy}>
                    Start from Call No. {registerSeed.callNo}&rsquo;s register ({registerSeed.rows.length} investors)
                  </Button>
                ) : investors.length > 0 ? (
                  <Button
                    variant="primary"
                    onClick={() => draft(investors.map((i) => ({ lpId: i.lpId, name: i.name, amount: 0, contactEmail: i.email })))}
                    loading={busy}
                  >
                    Start with the {investors.length} investor{investors.length === 1 ? '' : 's'} on the register
                  </Button>
                ) : null}
                <Button variant={registerSeed || investors.length ? 'secondary' : 'primary'} onClick={() => draft()} loading={busy}>
                  {registerSeed || investors.length ? 'Start with no one' : 'Draft the first close'}
                </Button>
              </div>
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                Nothing is saved but the date until you add who commits and press Save.
              </p>
            </div>
          )}
        </Card>
      )}

      {closings.map((c) => (
        <ClosingCard
          fundName={fundName}
          seed={seeded?.closingId === c.id ? seeded.rows : undefined}
          key={c.id}
          fundId={fundId}
          closing={c}
          first={c.id === closings[0]?.id}
          preview={previews[c.id] ?? null}
          settledOn={settledOn[c.id] ?? []}
          statements={statements.filter((x) => x.closingId === c.id)}
          investors={investors}
          canWrite={canWrite}
          blockedBy={
            closings.find((x) => !x.finalised && x.id !== c.id && x.closingDate < c.closingDate)?.closingNo ?? null
          }
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

interface Row {
  lpId: string;
  name: string;
  amount: string;
  feeRateOverride: string;
  feeExempt: boolean;
  contactEmail: string;
}

/** The rows as what they record, for telling whether anything changed. */
const meaning = (rows: Row[]) =>
  JSON.stringify(
    rows.map((r) => {
      const amount = Number(r.amount.replace(/[,\s]/g, ''));
      return [r.lpId.trim(), r.name.trim(), Number.isFinite(amount) ? amount : r.amount, rateOf(r.feeRateOverride), r.feeExempt, r.contactEmail.trim()];
    }),
  );

const toRows = (c: Closing): Row[] =>
  c.commitments.map((k) => ({
    lpId: k.lpId,
    name: k.name,
    amount: String(k.amount),
    feeRateOverride: toDraft(RATE, k.feeRateOverride),
    feeExempt: k.feeExempt,
    contactEmail: k.contactEmail ?? '',
  }));

function ClosingCard({
  fundId,
  fundName,
  seed,
  closing,
  first,
  preview,
  settledOn,
  statements,
  investors,
  canWrite,
  blockedBy,
  onChanged,
}: {
  fundId: string;
  fundName: string;
  /** Rows a just-drafted closing starts with, unsaved. */
  seed?: Row[];
  closing: Closing;
  first: boolean;
  preview: EqualizationResult | null;
  settledOn: number[];
  statements: ClosingStatement[];
  investors: FundInvestor[];
  canWrite: boolean;
  /** An earlier draft closing that has to be finalised first. */
  blockedBy: number | null;
  onChanged: () => void;
}) {
  const editable = canWrite && !closing.finalised;
  const [rows, setRows] = useState<Row[]>(() => seed ?? toRows(closing));
  const [date, setDate] = useState(closing.closingDate);
  const [note, setNote] = useState(closing.note ?? '');
  const [busy, setBusy] = useState<'save' | 'finalise' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ name: string; count: number; errors: string[] } | null>(null);

  // Compared by what the rows mean, not how they were typed: "60,000,000" and
  // the 60000000 it is saved as are the same commitment.
  const saved = meaning(toRows(closing)) === meaning(rows) && date === closing.closingDate && note === (closing.note ?? '');
  useLeaveGuard(editable && !saved);
  const total = rows.reduce((s, r) => s + (Number(r.amount.replace(/[,\s]/g, '')) || 0), 0);
  const failing = preview?.checks.filter((k) => k.level === 'fail') ?? [];

  function problems(): string | null {
    const ids = rows.map((r) => r.lpId.trim()).filter(Boolean);
    if (new Set(ids).size !== ids.length) return 'Each investor can appear once in a closing.';
    for (const r of rows) {
      if (!r.lpId.trim()) return 'Every row needs an LP_ID.';
      if (!r.name.trim()) return `${r.lpId}: add the investor’s name.`;
      const n = Number(r.amount.replace(/[,\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) return `${r.lpId}: the commitment has to be an amount above zero.`;
      const rate = fromDraft(RATE, r.feeRateOverride);
      if ('error' in rate) return `${r.lpId}: side-letter rate — ${rate.error}`;
    }
    return null;
  }

  async function save() {
    const p = problems();
    if (p) return setError(p);
    setBusy('save');
    setError(null);
    try {
      const repo = createSupabaseRepository(createBrowserSupabase());
      await repo.updateClosing(closing.id, { closingDate: date, note: note.trim() || null });
      await repo.saveClosingCommitments(
        closing.id,
        rows.map((r) => ({
          lpId: r.lpId.trim(),
          name: r.name.trim(),
          amount: Number(r.amount.replace(/[,\s]/g, '')),
          feeRateOverride: rateOf(r.feeRateOverride),
          feeExempt: r.feeExempt,
          contactEmail: r.contactEmail.trim() || null,
        })),
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the closing.');
    } finally {
      setBusy(null);
    }
  }

  const [confirming, setConfirming] = useState<'finalise' | 'delete' | null>(null);
  // Money moves at this closing, so finalising says how it is settled.
  const toSettle = !first && Boolean(preview?.lines.some((l) => l.net !== 0));
  const [settlement, setSettlement] = useState<Settlement | null>(null);

  async function finalise() {
    setConfirming(null);
    setBusy('finalise');
    setError(null);
    try {
      const res = await fetch(`/api/funds/${fundId}/closings/${closing.id}/finalise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlement: toSettle ? settlement : null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not finalise the closing.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finalise the closing.');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setConfirming(null);
    setBusy('delete');
    try {
      await createSupabaseRepository(createBrowserSupabase()).deleteClosing(closing.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the closing.');
      setBusy(null);
    }
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const known = new Map(investors.map((i) => [i.lpId, i]));
  // Anyone this closing names whose profile is not finished: already known and
  // incomplete, or new, and so bare until someone completes them.
  const unfinished = rows
    .map((r) => r.lpId.trim())
    .filter(Boolean)
    .filter((id) => {
      const k = known.get(id);
      return !k || profileGaps(k).length > 0;
    });

  const finaliseBlock = !saved
    ? 'Save your changes first.'
    : blockedBy
      ? `Finalise closing ${blockedBy} first.`
      : rows.length === 0
        ? 'Admit at least one investor.'
        : failing.length
          ? 'Resolve the failing checks below.'
          : null;

  return (
    <Card
      style={{ marginTop: 24 }}
      title={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          Closing {closing.closingNo}
          <Tag tone={first ? 'neutral' : 'accent'}>{first ? 'First close' : 'Later close'}</Tag>
          <Tag tone={closing.finalised ? 'neutral' : 'warn'}>{closing.finalised ? 'Finalised' : 'Draft'}</Tag>
        </span>
      }
      subtitle={`${fmtDate(closing.closingDate)} · ${rows.length} investor${rows.length === 1 ? '' : 's'} · ${fmt(total)}`}
      bodyPadding="16px"
    >
      {editable && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>
            Closing date{' '}
            <input className="cell" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160, border: '1px solid var(--border)' }} />
          </label>
          <input
            className="cell"
            aria-label="Note"
            placeholder="Note, e.g. Second close: two new institutional investors"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1, minWidth: 240, border: '1px solid var(--border)' }}
          />
          <TemplateButtons
            fileName={`${fundName} — closing ${closing.closingNo} commitments.xlsx`}
            importLabel="Import commitments"
            build={(XLSX) => commitmentsTemplate(XLSX as unknown as WorkbookWriter, fundName, closing.closingNo)}
            onImport={(XLSX, wb, name) => {
              const sheet = wb.Sheets[COMMITMENTS_SHEET];
              const grid = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][]) : null;
              const read = readCommitmentsTemplate(grid);
              // Replaces the rows on screen, not what is saved: Save is still the person's.
              if (read.rows.length) {
                setRows(
                  read.rows.map((k) => ({
                    lpId: k.lpId,
                    name: k.name,
                    amount: String(k.amount),
                    feeRateOverride: toDraft(RATE, k.feeRateOverride ?? null),
                    feeExempt: Boolean(k.feeExempt),
                    contactEmail: k.contactEmail ?? '',
                  })),
                );
              }
              setImported({ name, count: read.rows.length, errors: read.errors });
            }}
          />
        </div>
      )}

      {editable && imported && (
        <div style={{ display: 'grid', gap: 4, fontSize: 13, marginBottom: 10 }}>
          <span>
            <Tag tone="accent">Imported</Tag> {imported.count} investor{imported.count === 1 ? '' : 's'} from {imported.name}
            {imported.count ? ', in place of the rows that were here. Check them, then Save.' : '. Nothing was changed.'}
          </span>
          {imported.errors.map((e) => (
            <span key={e} style={{ color: 'var(--destructive)' }}>
              Not imported — {e}
            </span>
          ))}
        </div>
      )}

      {editable && (
        <datalist id={`closing-${closing.id}-investors`}>
          {investors.map((x) => (
            <option key={x.lpId} value={x.lpId}>
              {x.name}
            </option>
          ))}
        </datalist>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Investor</th>
              <th>Name</th>
              <th style={{ textAlign: 'right' }}>Commitment</th>
              <th>
                Side-letter rate
                <InfoTip label="Side-letter rate">A management fee rate agreed with this investor instead of the fund&rsquo;s, as a fraction: 0.01 is 1%. Blank for the fund&rsquo;s rate.</InfoTip>
              </th>
              <th>Exempt</th>
              <th>Email</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              editable ? (
                <tr key={i}>
                  <td style={{ padding: '2px 6px' }}>
                    {/* Typed, with the fund's investors suggested: a later close is
                        exactly when an investor new to the fund arrives, so a new
                        LP_ID has to be allowed. Picking a known one fills its name. */}
                    <input
                      className="cell mono"
                      aria-label={`Investor ${i + 1}`}
                      placeholder="LP_ID, e.g. LP07"
                      list={`closing-${closing.id}-investors`}
                      value={r.lpId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const k = known.get(id.trim());
                        set(i, k ? { lpId: id, name: k.name, contactEmail: k.email ?? '' } : { lpId: id });
                      }}
                    />
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    {/* The register owns who an investor is: a known one reads from
                        their profile, and only someone new is named here. */}
                    {known.has(r.lpId.trim()) ? (
                      <Link href={`/funds/${fundId}/investors/${encodeURIComponent(r.lpId.trim())}`} style={{ fontSize: 13 }}>
                        {known.get(r.lpId.trim())!.name}
                      </Link>
                    ) : (
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="cell" aria-label={`Name ${i + 1}`} placeholder="e.g. Eta Capital Partners" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                        {r.lpId.trim() && <Tag tone="warn">New</Tag>}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    <input className="cell" aria-label={`Commitment ${i + 1}`} placeholder="e.g. 5000000" style={{ textAlign: 'right' }} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    <input className="cell" aria-label={`Side-letter rate ${i + 1}`} placeholder="e.g. 1.5%, blank = fund rate" style={{ textAlign: 'right' }} value={r.feeRateOverride} onChange={(e) => set(i, { feeRateOverride: e.target.value })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" aria-label={`Exempt ${i + 1}`} checked={r.feeExempt} onChange={(e) => set(i, { feeExempt: e.target.checked })} />
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    {known.has(r.lpId.trim()) ? (
                      <span className="text-muted" style={{ fontSize: 13 }}>
                        {known.get(r.lpId.trim())!.email ?? '—'}
                      </span>
                    ) : (
                      <input className="cell" aria-label={`Email ${i + 1}`} placeholder="for notices" value={r.contactEmail} onChange={(e) => set(i, { contactEmail: e.target.value })} />
                    )}
                  </td>
                  <td>
                    <button type="button" className="link-button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.lpId || 'row'}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={i}>
                  <td className="mono">{r.lpId}</td>
                  <td>{r.name}</td>
                  <td className="num">{fmt(Number(r.amount))}</td>
                  <td>{rateOf(r.feeRateOverride) !== null ? pct(rateOf(r.feeRateOverride)!) : <span className="text-muted">fund rate</span>}</td>
                  <td>{r.feeExempt ? 'Yes' : ''}</td>
                  <td className="text-muted">{r.contactEmail}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {editable && unfinished.length > 0 && (
        <p style={{ fontSize: 13, margin: '10px 0 0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Tag tone="warn">Profiles to finish</Tag>
          <span style={{ textWrap: 'pretty' }}>
            {unfinished.join(', ')} {unfinished.length === 1 ? 'has' : 'have'} no complete profile yet — type, notices email
            or country. You can still finalise; finish them on{' '}
            <Link href={`/funds/${fundId}/investors`}>Investors</Link> before their first notice goes out.
          </span>
        </p>
      )}

      {editable && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <Button
            small
            onClick={() => setRows((rs) => [...rs, { lpId: '', name: '', amount: '', feeRateOverride: '', feeExempt: false, contactEmail: '' }])}
          >
            + Admit an investor
          </Button>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="ghost" onClick={() => setConfirming('delete')} loading={busy === 'delete'} disabled={busy !== null}>
              Delete draft
            </Button>
            <Button onClick={save} loading={busy === 'save'} disabled={busy !== null || saved}>
              {saved ? 'Saved' : 'Save'}
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirming('finalise')}
              loading={busy === 'finalise'}
              disabled={busy !== null || finaliseBlock !== null}
              title={finaliseBlock ?? `Freeze closing ${closing.closingNo}${first ? '' : ' and its equalization'}`}
            >
              Finalise
            </Button>
          </span>
        </div>
      )}
      {editable && finaliseBlock && rows.length > 0 && (
        <p className="text-muted" style={{ fontSize: 12, textAlign: 'right', margin: '6px 0 0' }}>
          {finaliseBlock}
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>
          {error}
        </p>
      )}

      {first ? (
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 0 }}>
          The first close admits everyone at the start, so there is nothing to equalize.
        </p>
      ) : preview ? (
        <>
          {closing.finalised && toSettle && (
            <div style={{ marginTop: 16 }}>
              <SettlementCard
                fundId={fundId}
                closingId={closing.id}
                closingNo={closing.closingNo}
                settlement={closing.settlement ?? null}
                settledOn={settledOn}
                statementsSent={statements.filter((x) => x.status === 'sent').length}
                canWrite={canWrite}
                onChanged={onChanged}
              />
            </div>
          )}
          {closing.finalised && toSettle && closing.settlement === 'on_closing' && (
            <div style={{ marginTop: 16 }}>
              <StatementsCard
                fundId={fundId}
                closingId={closing.id}
                closingNo={closing.closingNo}
                result={preview}
                statements={statements}
                canWrite={canWrite}
                statementHref={(lpId) => `/api/funds/${fundId}/closings/${closing.id}/statement?lpId=${encodeURIComponent(lpId)}`}
                onChanged={onChanged}
              />
            </div>
          )}
        <EqualizationPanel
          result={preview}
          finalised={closing.finalised}
          statementHref={(lpId) => `/api/funds/${fundId}/closings/${closing.id}/statement?lpId=${encodeURIComponent(lpId)}`}
        />
        </>
      ) : null}
      {!first && !saved && editable && (
        <p className="text-muted" style={{ fontSize: 12 }}>
          The equalization above is for what was last saved. Save to see it with your changes.
        </p>
      )}
      {confirming === 'finalise' && (
        <ConfirmDialog
          title={`Finalise closing ${closing.closingNo}?`}
          confirm={`Finalise closing ${closing.closingNo}`}
          busy={busy === 'finalise'}
          disabled={toSettle && !settlement}
          onConfirm={finalise}
          onCancel={() => setConfirming(null)}
        >
          <p style={{ margin: 0 }}>
            {fmtDate(date)} · {rows.length} investor{rows.length === 1 ? '' : 's'} · {fmt(total)} committed
          </p>
          {!first && preview && (
            <p style={{ margin: 0 }}>
              Late investors pay {fmt(preview.lines.filter((l) => l.role !== 'earlier').reduce((t, l) => t + Math.max(l.net, 0), 0))},
              of which {fmt(preview.totals.moved)} capital goes back to the investors already in.
            </p>
          )}
          {toSettle && (
            <>
              <strong style={{ marginTop: 4 }}>How is the equalization settled?</strong>
              <SettlementOptions name={`finalise-${closing.id}`} value={settlement} onChange={setSettlement} />
            </>
          )}
          <p className="text-muted" style={{ margin: 0 }}>
            After this, who it admits{first ? '' : ' and its equalization'} cannot be changed. A mistake is put right with a
            later closing.{toSettle ? ' How it is settled can change until a call carrying it is sent.' : ''}
          </p>
        </ConfirmDialog>
      )}
      {confirming === 'delete' && (
        <ConfirmDialog
          title={`Delete draft closing ${closing.closingNo}?`}
          confirm="Delete draft"
          danger
          busy={busy === 'delete'}
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        >
          <p style={{ margin: 0 }}>The draft and who it lists are removed. The investors stay on the register.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

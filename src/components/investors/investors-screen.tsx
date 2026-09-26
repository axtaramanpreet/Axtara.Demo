'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { FundInvestor } from '@/adapters/storage/types';
import { fmt, pct, type Position } from '@/engine';
import { INVESTOR_TYPES, KYC_LABEL, profileGaps } from '@/lib/investor-profile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { Tag } from '@/components/ui/tag';
import { TemplateButtons } from '@/components/ui/template-buttons';
import {
  INVESTORS_SHEET,
  investorsTemplate,
  readInvestorsTemplate,
  type InvestorImportRow,
  type WorkbookWriter,
} from '@/adapters/workbook/templates';

/**
 * The fund's investor register: who they are, and where each stands.
 *
 * The register is the master list. Closings pick from it, and a closing that
 * names someone new adds them here, flagged until their profile is finished.
 */
export function InvestorsScreen({
  fundId,
  fundName,
  investors,
  positions,
  asOf,
  canWrite,
}: {
  fundId: string;
  fundName: string;
  investors: FundInvestor[];
  /** Where each investor stands, worked out on the server. */
  positions: Position[];
  /** What the balances are as at, in words. */
  asOf: string;
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<{ name: string; rows: InvestorImportRow[]; errors: string[] } | null>(null);
  const at = new Map(positions.map((p) => [p.lpId, p]));
  const committed = positions.reduce((s, p) => s + p.commitment, 0);
  const paid = positions.reduce((s, p) => s + p.paidIn, 0);
  const incomplete = investors.filter((i) => profileGaps(i).length).length;

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1>Investors</h1>
          <p className="text-muted" style={{ maxWidth: 640, textWrap: 'pretty' }}>
            Every investor in the fund, and where each stands {asOf}. Closings pick from this list; someone new at a
            closing is added here.
          </p>
        </div>
        {canWrite && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TemplateButtons
              fileName={`${fundName} — investors.xlsx`}
              importLabel="Import investors"
              build={(XLSX) => investorsTemplate(XLSX as unknown as WorkbookWriter, fundName, INVESTOR_TYPES, Object.values(KYC_LABEL))}
              onImport={(XLSX, wb, name) => {
                const sheet = wb.Sheets[INVESTORS_SHEET];
                const grid = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][]) : null;
                setImporting({ name, ...readInvestorsTemplate(grid, INVESTOR_TYPES, KYC_LABEL) });
              }}
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add investor
            </Button>
          </div>
        )}
      </div>

      {investors.length === 0 ? (
        <Card style={{ marginTop: 24, maxWidth: 640 }} bodyPadding="24px">
          <h3 style={{ marginTop: 0 }}>No investors yet</h3>
          <p className="text-muted" style={{ textWrap: 'pretty' }}>
            Add each investor as they are onboarded: who they are, where their notices go, and where their KYC stands.
            For many at once, download the template, fill it in and import it. Or skip ahead — a closing adds anyone
            it names who is not here yet.
          </p>
        </Card>
      ) : (
        <>
          <div className="stat-row" style={{ marginTop: 16 }}>
            <Stat label="Investors" value={String(investors.length)} info="Everyone on the fund's register, whether or not they have committed yet." />
            <Stat label="Committed" value={fmt(committed)} info="What every investor has committed, across all closings." />
            <Stat label="Paid in" value={committed ? pct(paid / committed) : '—'} info="What has been paid in so far, as a share of what was committed." />
            <Stat
              label="Profiles to finish"
              value={incomplete ? String(incomplete) : 'None'}
              info="Investors missing their type, notices email or country. Usually someone a closing added before they were onboarded here."
            />
          </div>

          <Card style={{ marginTop: 16 }} title="Register" subtitle="open an investor for their profile, capital account and documents">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Investor</th>
                    <th>Type</th>
                    <th>Country</th>
                    <th style={{ textAlign: 'right' }}>Commitment</th>
                    <th style={{ textAlign: 'right' }}>Paid in</th>
                    <th style={{ textAlign: 'right' }}>Unfunded</th>
                    <th>KYC</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {investors.map((i) => {
                    const p = at.get(i.lpId);
                    const gaps = profileGaps(i);
                    return (
                      <tr key={i.id}>
                        <td>
                          <Link href={`/funds/${fundId}/investors/${encodeURIComponent(i.lpId)}`} style={{ textDecoration: 'none' }}>
                            <span className="mono">{i.lpId}</span> {i.name}
                          </Link>{' '}
                          {i.isGp && <Tag>GP</Tag>}
                        </td>
                        <td>{gaps.includes('investor type') ? <span className="text-muted">—</span> : i.type}</td>
                        <td>{i.country ?? <span className="text-muted">—</span>}</td>
                        <td className="num">{p ? fmt(p.commitment) : '—'}</td>
                        <td className="num">{p ? fmt(p.paidIn) : '—'}</td>
                        <td className="num">{p ? fmt(p.unfunded) : '—'}</td>
                        <td>
                          <Tag tone={i.kycStatus === 'approved' ? 'accent' : i.kycStatus === 'expired' ? 'danger' : 'neutral'}>
                            {KYC_LABEL[i.kycStatus]}
                          </Tag>
                        </td>
                        <td>{gaps.length > 0 && <Tag tone="warn" >Profile incomplete</Tag>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {adding && <AddInvestor fundId={fundId} taken={investors.map((i) => i.lpId)} onClose={() => setAdding(false)} />}
      {importing && <ImportInvestors fundId={fundId} file={importing} existing={investors} onClose={() => setImporting(null)} />}
    </div>
  );
}

/** Adding an investor as they are onboarded, before any closing admits them. */
function AddInvestor({ fundId, taken, onClose }: { fundId: string; taken: string[]; onClose: () => void }) {
  const router = useRouter();
  const [lpId, setLpId] = useState(nextId(taken));
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);



  const [added, setAdded] = useState<string[]>([]);
  const taken_ = [...taken, ...added];
  const clash = taken_.includes(lpId.trim());

  /** Add, then either open the investor's page or clear the form for the next one. */
  async function add(e: React.FormEvent, another = false) {
    e.preventDefault();
    if (!lpId.trim() || !name.trim() || taken_.includes(lpId.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await createSupabaseRepository(createBrowserSupabase()).createInvestor(fundId, lpId, { name, type: type || 'LP' });
      if (another) {
        const next = [...added, lpId.trim()];
        setAdded(next);
        setLpId(nextId([...taken, ...next]));
        setName('');
        setType('');
        setBusy(false);
        router.refresh();
        first.current?.focus();
      } else {
        router.push(`/funds/${fundId}/investors/${encodeURIComponent(lpId.trim())}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the investor.');
      setBusy(false);
    }
  }

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-investor-title" onSubmit={add}>
        <h2 id="add-investor-title" style={{ margin: 0, fontSize: 18 }}>
          Add investor
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, marginTop: 16, fontSize: 13 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontWeight: 500 }}>LP_ID</span>
            <input className="cell" value={lpId} onChange={(e) => setLpId(e.target.value)} style={{ border: '1px solid var(--border)', height: 36 }} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontWeight: 500 }}>Legal name</span>
            <input
              ref={first}
              className="cell"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northbridge Teachers’ Pension Plan"
              style={{ border: '1px solid var(--border)', height: 36 }}
            />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 6, marginTop: 10, fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>Type</span>
          <select className="cell" value={type} onChange={(e) => setType(e.target.value)} style={{ border: '1px solid var(--border)', height: 36 }}>
            <option value="">Choose later</option>
            {INVESTOR_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {clash && <p style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--destructive)' }}>{lpId.trim()} is already an investor in this fund.</p>}
        <p className="text-muted" style={{ fontSize: 13, margin: '14px 0 0' }}>
          {added.length
            ? `Added ${added.join(', ')}. Finish each profile from the register.`
            : 'Next, their page: where notices go, who gets a copy, their country and KYC.'}
        </p>
        {error && (
          <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, margin: '10px 0 0' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            {added.length ? 'Done' : 'Cancel'}
          </Button>
          <Button type="button" onClick={(e) => add(e, true)} disabled={!lpId.trim() || !name.trim() || clash || busy}>
            Add and add another
          </Button>
          <Button type="submit" variant="primary" disabled={!lpId.trim() || !name.trim() || clash} loading={busy}>
            Add investor
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The next free LP number: LP01, LP02… after the highest one in use. */
export function nextId(taken: string[]): string {
  const n = taken.map((id) => /^LP(\d+)$/i.exec(id)?.[1]).filter(Boolean).map(Number);
  const next = (n.length ? Math.max(...n) : 0) + 1;
  return `LP${String(next).padStart(2, '0')}`;
}

/**
 * What an imported register would do — who is new, whose profile changes, and
 * which rows cannot be read — shown before anything is saved.
 *
 * A blank cell never clears a profile, the same rule calls and closings follow:
 * clearing a detail is done on the investor's page.
 */
function ImportInvestors({
  fundId,
  file,
  existing,
  onClose,
}: {
  fundId: string;
  file: { name: string; rows: InvestorImportRow[]; errors: string[] };
  existing: FundInvestor[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = new Map(existing.map((i) => [i.lpId, i]));
  const fresh = file.rows.filter((r) => !known.has(r.lpId));
  const updates = file.rows
    .filter((r) => known.has(r.lpId))
    .map((r) => {
      const was = known.get(r.lpId)!;
      const patch = {
        ...(r.name !== was.name && { name: r.name }),
        ...(r.type && r.type !== was.type && { type: r.type }),
        ...(r.country && r.country !== was.country && { country: r.country }),
        ...(r.email && r.email !== was.email && { email: r.email }),
        ...(r.ccEmails.length && r.ccEmails.join() !== was.ccEmails.join() && { ccEmails: r.ccEmails }),
        ...(r.isGp && !was.isGp && { isGp: true }),
        ...(r.kycStatus !== 'not_started' && r.kycStatus !== was.kycStatus && { kycStatus: r.kycStatus }),
      };
      return { investor: was, patch };
    })
    .filter((u) => Object.keys(u.patch).length > 0);

  async function run() {
    setBusy(true);
    setError(null);
    const repo = createSupabaseRepository(createBrowserSupabase());
    try {
      for (const r of fresh) {
        await repo.createInvestor(fundId, r.lpId, { name: r.name, type: r.type || 'LP', country: r.country, email: r.email, ccEmails: r.ccEmails, isGp: r.isGp, kycStatus: r.kycStatus });
      }
      for (const u of updates) await repo.updateInvestor(u.investor.id, u.patch);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import the investors.');
      setBusy(false);
    }
  }

  const nothing = fresh.length === 0 && updates.length === 0;
  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-investors-title" style={{ width: 'min(560px, 100%)' }}>
        <h2 id="import-investors-title" style={{ margin: 0, fontSize: 18 }}>
          Import {file.name}
        </h2>
        <div style={{ display: 'grid', gap: 10, marginTop: 14, fontSize: 13 }}>
          <div>
            <strong>{fresh.length} new</strong>
            {fresh.length > 0 && <span className="text-muted"> — {fresh.map((r) => r.lpId).join(', ')}</span>}
          </div>
          <div>
            <strong>{updates.length} profile{updates.length === 1 ? '' : 's'} updated</strong>
            {updates.map((u) => (
              <div key={u.investor.id} className="text-muted">
                {u.investor.lpId}: {Object.keys(u.patch).join(', ')}
              </div>
            ))}
          </div>
          {file.errors.length > 0 && (
            <div>
              <strong style={{ color: 'var(--destructive)' }}>{file.errors.length} row{file.errors.length === 1 ? '' : 's'} not imported</strong>
              {file.errors.map((e) => (
                <div key={e} style={{ color: 'var(--destructive)' }}>
                  {e}
                </div>
              ))}
            </div>
          )}
          <p className="text-muted" style={{ margin: 0 }}>A blank cell leaves a profile as it is. Nothing is saved until you press Import.</p>
        </div>
        {error && (
          <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, margin: '10px 0 0' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} disabled={nothing} loading={busy}>
            {nothing ? 'Nothing to import' : 'Import'}
          </Button>
        </div>
      </div>
    </div>
  );
}

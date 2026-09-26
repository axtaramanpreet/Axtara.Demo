'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { FundInvestor, KycStatus } from '@/adapters/storage/types';
import { fmt, fmtDate, pct, type CapitalAccount } from '@/engine';
import { INVESTOR_TYPES, KYC_LABEL, profileGaps } from '@/lib/investor-profile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InfoTip } from '@/components/ui/info-tip';
import { Tag } from '@/components/ui/tag';
import { useLeaveGuard } from '@/lib/hooks/use-leave-guard';

export interface InvestorDocument {
  date: string;
  label: string;
  href: string;
}

export interface SideLetterTerm {
  closingNo: number;
  date: string;
  finalised: boolean;
  amount: number;
  feeRate: number | null;
  exempt: boolean;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One investor, as the fund's administrators see them — and, later, as the
 * investor sees themselves in their portal: the same page, read-only.
 */
export function InvestorPage({
  investor,
  account,
  documents,
  sideLetters,
  canWrite,
}: {
  investor: FundInvestor;
  account: CapitalAccount;
  documents: InvestorDocument[];
  sideLetters: SideLetterTerm[];
  canWrite: boolean;
}) {
  const gaps = profileGaps(investor);
  const last = account.entries.at(-1);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>
          <span className="mono" style={{ fontSize: '0.8em' }}>
            {investor.lpId}
          </span>{' '}
          {investor.name}
        </h1>
        {investor.isGp && <Tag>General partner</Tag>}
        <Tag tone={investor.kycStatus === 'approved' ? 'accent' : investor.kycStatus === 'expired' ? 'danger' : 'neutral'}>
          KYC {KYC_LABEL[investor.kycStatus].toLowerCase()}
        </Tag>
        {gaps.length > 0 && <Tag tone="warn">Profile incomplete</Tag>}
      </div>
      {last && (
        <p className="text-muted" style={{ marginTop: 6 }}>
          Committed {fmt(last.commitmentAfter)} · paid in {fmt(last.paidAfter)}
          {last.commitmentAfter ? ` (${pct(last.paidAfter / last.commitmentAfter)})` : ''} · unfunded {fmt(last.unfundedAfter)}
        </p>
      )}

      <Profile investor={investor} gaps={gaps} canWrite={canWrite} />

      <Card
        style={{ marginTop: 16 }}
        title="Capital account"
        subtitle={account.fromRecord ? 'every closing, call and equalization, in order' : 'each call as it was issued'}
      >
        {account.entries.length === 0 ? (
          <p className="text-muted" style={{ padding: '14px 16px', margin: 0 }}>
            Nothing yet. Their first entry is the closing that admits them.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th style={{ textAlign: 'right' }}>Committed</th>
                  <th style={{ textAlign: 'right' }}>Paid in</th>
                  <th style={{ textAlign: 'right' }}>Of which against commitment</th>
                  <th style={{ textAlign: 'right' }}>Total committed</th>
                  <th style={{ textAlign: 'right' }}>Total paid in</th>
                  <th style={{ textAlign: 'right' }}>Unfunded</th>
                </tr>
              </thead>
              <tbody>
                {account.entries.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
                    <td>
                      {e.label}
                      {e.interest !== 0 && (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {' '}
                          · interest {e.interest > 0 ? 'paid' : 'received'} {fmt(Math.abs(e.interest))}
                          <InfoTip label="Late-close interest">
                            Interest on catching up at a later close. It is paid to, or by, the other investors — it is not
                            capital, so it moves none of the balances.
                          </InfoTip>
                        </span>
                      )}
                    </td>
                    <td className="num">{e.commitment ? fmt(e.commitment) : '—'}</td>
                    <td className="num">{e.paid ? signed(e.paid) : '—'}</td>
                    <td className="num">{e.drawn ? signed(e.drawn) : '—'}</td>
                    <td className="num">{fmt(e.commitmentAfter)}</td>
                    <td className="num">{fmt(e.paidAfter)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {fmt(e.unfundedAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0 }}>
          Paid in includes the management fee billed on each call. Equalization counts on the closing date, whichever
          document collects the cash; late-close interest is shown beside it, and is not capital.
        </p>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16, marginTop: 16 }}>
        <Card title="Documents" subtitle="their notices and statements">
          {documents.length === 0 ? (
            <p className="text-muted" style={{ padding: '14px 16px', margin: 0 }}>
              None yet.
            </p>
          ) : (
            <table className="table">
              <tbody>
                {documents.map((d) => (
                  <tr key={d.href}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</td>
                    <td>{d.label}</td>
                    <td style={{ textAlign: 'right' }}>
                      <a href={d.href} className="crumb">
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Commitments and side letters" subtitle="as each closing recorded them">
          {sideLetters.length === 0 ? (
            <p className="text-muted" style={{ padding: '14px 16px', margin: 0 }}>
              Not admitted at any closing yet.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Closing</th>
                  <th style={{ textAlign: 'right' }}>Committed</th>
                  <th>Management fee</th>
                </tr>
              </thead>
              <tbody>
                {sideLetters.map((s) => (
                  <tr key={s.closingNo}>
                    <td>
                      {s.closingNo} · {fmtDate(s.date)} {!s.finalised && <Tag tone="warn">Draft</Tag>}
                    </td>
                    <td className="num">{fmt(s.amount)}</td>
                    <td>{s.exempt ? 'Exempt' : s.feeRate ? `${pct(s.feeRate)} by side letter` : 'Fund rate'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

const signed = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

/** The profile, and the form to change it. */
function Profile({ investor, gaps, canWrite }: { investor: FundInvestor; gaps: string[]; canWrite: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => formOf(investor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useLeaveGuard(editing && JSON.stringify(form) !== JSON.stringify(formOf(investor)));

  async function save() {
    const copies = form.cc.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    const bad = [form.email, ...copies].filter((e) => e && !EMAIL.test(e));
    if (!form.name.trim()) return setError('The investor needs a legal name.');
    if (bad.length) return setError(`Not an email address: ${bad.join(', ')}`);
    setBusy(true);
    setError(null);
    try {
      await createSupabaseRepository(createBrowserSupabase()).updateInvestor(investor.id, {
        name: form.name,
        type: form.type,
        email: form.email,
        ccEmails: copies,
        country: form.country,
        isGp: form.isGp,
        kycStatus: form.kycStatus,
        sideLetterRef: form.sideLetterRef,
        notes: form.notes,
      });
      setEditing(false);
      startRefresh(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the investor.');
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string, React.ReactNode][] = [
    ['Legal name', 'As it appears on notices and statements.', investor.name],
    ['Type', 'What kind of investor this is.', gaps.includes('investor type') ? <Tag tone="warn">Not set</Tag> : investor.type],
    ['Country', 'Where the investor is domiciled.', investor.country ?? <Tag tone="warn">Not set</Tag>],
    ['Notices go to', 'The address every capital call notice is sent to.', investor.email ?? <Tag tone="warn">Not set</Tag>],
    ['Copies to', 'Everyone else who gets a copy of each notice — a finance team, an adviser.', investor.ccEmails.length ? investor.ccEmails.join(', ') : <span className="text-muted">No one</span>],
    ['General partner', 'Whether this is the general partner’s own commitment.', investor.isGp ? 'Yes' : 'No'],
    ['KYC', 'Where know-your-customer checks stand, as recorded by the team.', KYC_LABEL[investor.kycStatus]],
    ['Side letter', 'A reference to their side letter, if they have one.', investor.sideLetterRef ?? <span className="text-muted">None</span>],
    ['Notes', 'Anything the team should know.', investor.notes ?? <span className="text-muted">None</span>],
  ];

  return (
    <Card
      style={{ marginTop: 20, opacity: refreshing ? 0.6 : 1 }}
      title="Profile"
      subtitle={gaps.length ? `to finish: ${gaps.join(', ')}` : 'complete'}
    >
      {!editing ? (
        <>
          <dl className="kv" style={{ gridTemplateColumns: '200px 1fr', padding: '14px 16px' }}>
            {rows.map(([label, info, value]) => [
              <dt key={`${label}-t`}>
                {label}
                <InfoTip label={label}>{info}</InfoTip>
              </dt>,
              <dd key={`${label}-d`}>{value}</dd>,
            ])}
          </dl>
          {canWrite && (
            <div style={{ padding: '0 16px 14px' }}>
              <Button
                onClick={() => {
                  setForm(formOf(investor));
                  setError(null);
                  setEditing(true);
                }}
              >
                Edit profile
              </Button>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12, fontSize: 13 }}>
            <Field label="Legal name">
              <input className="cell bordered" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Type">
              <select className="cell bordered" value={form.type} onChange={(e) => set({ type: e.target.value })}>
                <option value="">Not set</option>
                {INVESTOR_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
                {form.type && !INVESTOR_TYPES.includes(form.type) && <option value={form.type}>{form.type}</option>}
              </select>
            </Field>
            <Field label="Country">
              <input className="cell bordered" value={form.country} onChange={(e) => set({ country: e.target.value })} placeholder="e.g. Canada" />
            </Field>
            <Field label="Notices go to">
              <input className="cell bordered" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="e.g. capital-calls@investor.com" />
            </Field>
            <Field label="Copies to">
              <input className="cell bordered" value={form.cc} onChange={(e) => set({ cc: e.target.value })} placeholder="Addresses, separated by commas" />
            </Field>
            <Field label="KYC">
              <select className="cell bordered" value={form.kycStatus} onChange={(e) => set({ kycStatus: e.target.value as KycStatus })}>
                {(Object.keys(KYC_LABEL) as KycStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {KYC_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Side letter reference">
              <input className="cell bordered" value={form.sideLetterRef} onChange={(e) => set({ sideLetterRef: e.target.value })} placeholder="e.g. SL-2026-03" />
            </Field>
            <Field label="Notes">
              <input className="cell bordered" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={form.isGp} onChange={(e) => set({ isGp: e.target.checked })} />
            This is the general partner’s own commitment
          </label>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            A fee exemption or a side-letter rate is set on the closing that admits them, with the commitment it applies
            to.
          </p>
          {error && (
            <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              Save profile
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function formOf(i: FundInvestor) {
  return {
    name: i.name,
    // A legacy 'LP'/'GP' says nothing, so the form asks for a real type.
    type: i.type === 'LP' || i.type === 'GP' ? '' : i.type,
    email: i.email ?? '',
    cc: i.ccEmails.join(', '),
    country: i.country ?? '',
    isGp: i.isGp,
    kycStatus: i.kycStatus,
    sideLetterRef: i.sideLetterRef ?? '',
    notes: i.notes ?? '',
  };
}

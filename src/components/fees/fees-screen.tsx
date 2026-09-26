'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import {
  fmt,
  fmtDate,
  pct,
  periodMonths,
  type CatchUpFee,
  type FeeLedgerEntry,
  type FeeLine,
  type FundTerms,
  type TrueUpLine,
} from '@/engine';
import { basisInWords } from '@/lib/fund-terms-fields';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { Tag } from '@/components/ui/tag';

type Entry = FeeLedgerEntry;

const STATUS: Record<Entry['status'], { label: string; tone: 'neutral' | 'accent' | 'warn' }> = {
  not_billed: { label: 'Not billed', tone: 'neutral' },
  billed: { label: 'Billed', tone: 'accent' },
  true_up_due: { label: 'True-up due', tone: 'warn' },
};

const sum = (lines: TrueUpLine[] | null) => (lines ?? []).reduce((s, l) => s + l.trueUp, 0);
const key = (e: Entry) => `${e.period.from}|${e.period.to}`;
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '—');
const billed = (e: Entry) => e.billedOn.reduce((t, b) => t + b.amount, 0);

/**
 * A fund's management fee, period by period, worked out on its own.
 *
 * Each period shows what the fee is as the record stands today, what calls
 * billed for it, and what is still owed. Nothing here is entered by hand: a
 * period is billed when a call bills it, and when the record moves after — a
 * later close admitted someone, a side letter arrived, the terms were
 * corrected — it shows the true-up, per investor.
 */
export function FeesScreen({
  fundId,
  ledger,
  catchUps,
  terms,
}: {
  fundId: string;
  /** Every fee period, oldest first. */
  ledger: Entry[];
  /** The catch-up fee each finalised later closing charged, oldest first. */
  catchUps: CatchUpFee[];
  /** The terms in force today. */
  terms: FundTerms | null;
}) {
  const due = ledger.filter((e) => e.status === 'true_up_due');
  const [open, setOpen] = useState<string | null>(() => {
    const first = due[0] ?? ledger[ledger.length - 1];
    return first ? key(first) : null;
  });
  const selected = ledger.find((e) => key(e) === open) ?? null;

  const billedTotal = ledger.reduce((s, e) => s + billed(e), 0);
  const owedTotal = ledger.reduce((s, e) => s + e.owedTotal, 0);
  const creditTotal = ledger.reduce((s, e) => s + e.creditTotal, 0);
  const catchUpToManager = catchUps.reduce((s, c) => s + c.toManager, 0);

  if (!terms?.feeRateAnnual) {
    return (
      <div style={{ maxWidth: 1200 }}>
        <h1>Management fees</h1>
        <Card style={{ marginTop: 24, maxWidth: 680 }} bodyPadding="24px">
          <h3 style={{ marginTop: 0 }}>No management fee set</h3>
          <p className="text-muted" style={{ textWrap: 'pretty' }}>
            The fee rate, what it is charged on and how often come from the fund&rsquo;s terms.
            Set them in Fund terms and every period is worked out from them.
          </p>
          <Link className="btn btn-primary" href={`/funds/${fundId}/settings`}>
            Set the fee terms
          </Link>
        </Card>
      </div>
    );
  }

  const months = periodMonths(terms.feePeriodFraction);
  const every = months === 12 ? 'yearly' : months === 6 ? 'half-yearly' : months === 3 ? 'quarterly' : `every ${months} months`;

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>Management fees</h1>
      <p className="text-muted" style={{ maxWidth: 680, textWrap: 'pretty' }}>
        {pct(terms.feeRateAnnual)} a year on {basisInWords(terms.feeBasis)}, charged {every}.{' '}
        <Link href={`/funds/${fundId}/settings`} className="crumb">
          Change in Fund terms
        </Link>
      </p>

      {ledger.length === 0 ? (
        <Card style={{ marginTop: 24, maxWidth: 680 }} bodyPadding="24px">
          <h3 style={{ marginTop: 0 }}>Nothing to charge yet</h3>
          <p className="text-muted" style={{ textWrap: 'pretty' }}>
            Fees run from the first close. Once it is finalised, each period appears here.
          </p>
          <Link className="btn btn-secondary" href={`/funds/${fundId}/closings`}>
            Go to Closings
          </Link>
        </Card>
      ) : (
        <>
          <div className="stat-row" style={{ marginTop: 16 }}>
            <Stat
              label="Billed so far"
              value={fmt(billedTotal)}
              info="The management fee billed to investors on capital calls, every period added up."
            />
            <Stat
              label="Still owed"
              value={fmt(owedTotal)}
              info="What the periods so far cost, as the record stands, less what calls billed. The next call can bill it on its Management fee step."
            />
            <Stat
              label="Over-billed"
              value={creditTotal ? fmt(creditTotal) : 'None'}
              info="Billed beyond what a period now costs — usually the terms were corrected after the call went out. It is owed back to the investors."
            />
            {catchUps.length > 0 && (
              <Stat
                label="Catch-up fees to the manager"
                value={fmt(catchUpToManager)}
                info="What investors who joined at a later close paid for the time before they joined, where the terms give it to the manager. Not part of any period below, and not in Billed so far."
              />
            )}
          </div>

          <Card style={{ marginTop: 16 }} title="By period" subtitle="open a period to see the working">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Dates</th>
                    <th />
                    <th style={{ textAlign: 'right' }}>Fee</th>
                    <th>Billed on</th>
                    <th style={{ textAlign: 'right' }}>Still owed</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ledger].reverse().map((e) => {
                    const s = STATUS[e.status];
                    return (
                      <tr
                        key={key(e)}
                        className="clickable"
                        onClick={() => setOpen(key(e))}
                        aria-current={open === key(e) || undefined}
                        style={open === key(e) ? { background: 'var(--muted)' } : undefined}
                      >
                        <td style={{ fontWeight: 600 }}>
                          {e.period.label}
                          {e.period.partial && <span className="text-muted"> (part)</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {fmtDate(e.period.from)} – {fmtDate(e.period.to)}
                        </td>
                        <td>
                          <Tag tone={s.tone}>{s.label}</Tag>
                        </td>
                        <td className="num">{fmt(e.now.total)}</td>
                        <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                          {e.billedOn.length ? e.billedOn.map((b) => `Call No. ${b.callNo} (${fmt(b.amount)})`).join(', ') : '—'}
                        </td>
                        <td className="num" style={{ fontWeight: e.owedTotal || e.creditTotal ? 600 : undefined }}>
                          {e.owedTotal ? fmt(e.owedTotal) : '—'}
                          {e.creditTotal ? <div className="text-muted">{fmt(e.creditTotal)} over-billed</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {catchUps.length > 0 && <CatchUpFees fundId={fundId} catchUps={catchUps} />}

          {selected && <PeriodDetail key={key(selected)} entry={selected} />}
        </>
      )}
    </div>
  );
}

function PeriodDetail({ entry }: { entry: Entry }) {
  const { period, now, drift, status, billedOn } = entry;
  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      {status === 'true_up_due' && drift && (
        <Card
          title={`${period.label}: true-up`}
          subtitle={`against what was billed on ${billedOn.map((b) => `Call No. ${b.callNo}`).join(', ')}`}
        >
          <TrueUpTable lines={drift.filter((l) => l.trueUp !== 0)} />
          <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0, textWrap: 'pretty' }}>
            What is still owed can go on the next call, on its Management fee step.
          </p>
        </Card>
      )}

      {now.notes.length > 0 && (
        <Card title="Notes">
          <ul style={{ margin: 0, padding: '12px 32px', fontSize: 13 }}>
            {now.notes.map((n, i) => (
              <li key={i}>
                {n.level === 'warn' && <Tag tone="warn">Check</Tag>} {n.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={`${period.label}, by investor`}
        subtitle={`${fmtDate(period.from)} – ${fmtDate(period.to)} · as the record stands today`}
      >
        <InvestorFees lines={now.lines} total={now.total} />
      </Card>
    </div>
  );
}

function TrueUpTable({ lines }: { lines: TrueUpLine[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Investor</th>
          <th style={{ textAlign: 'right' }}>Billed</th>
          <th style={{ textAlign: 'right' }}>Should have been</th>
          <th style={{ textAlign: 'right' }}>True-up</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.lpId}>
            <td>
              <span className="mono">{l.lpId}</span> {l.name}
            </td>
            <td className="num">{fmt(l.charged)}</td>
            <td className="num">{fmt(l.shouldHave)}</td>
            <td className="num" style={{ fontWeight: 600 }}>
              {signed(l.trueUp)}
            </td>
          </tr>
        ))}
        <tr>
          <td style={{ fontWeight: 600 }}>Total</td>
          <td className="num">{fmt(lines.reduce((s, l) => s + l.charged, 0))}</td>
          <td className="num">{fmt(lines.reduce((s, l) => s + l.shouldHave, 0))}</td>
          <td className="num" style={{ fontWeight: 600 }}>
            {signed(sum(lines))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function InvestorFees({ lines, total }: { lines: FeeLine[]; total: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Investor</th>
            <th>Rate</th>
            <th style={{ textAlign: 'right' }}>Fee</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const rates = [...new Set(l.slices.map((s) => s.rate))];
            return (
              <Fragment key={l.lpId}>
                <tr className="clickable" onClick={() => setOpen(open === l.lpId ? null : l.lpId)} aria-expanded={open === l.lpId}>
                  <td>
                    <span className="mono">{l.lpId}</span> {l.name}
                  </td>
                  <td>{l.exempt ? <Tag>Exempt</Tag> : rates.map((r) => pct(r)).join(', ')}</td>
                  <td className="num">{l.exempt ? '—' : fmt(l.fee)}</td>
                </tr>
                {open === l.lpId && (
                  <tr>
                    <td colSpan={3} style={{ background: 'var(--muted)', padding: '12px 16px' }}>
                      <strong style={{ fontSize: 13 }}>How was this worked out?</strong>
                      {l.exempt ? (
                        <p className="text-muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
                          This investor pays no management fee under their side letter.
                        </p>
                      ) : (
                        <table className="table working" style={{ marginTop: 8 }}>
                          <thead>
                            <tr>
                              <th>From</th>
                              <th>to</th>
                              <th>On</th>
                              <th style={{ textAlign: 'right' }}>Basis</th>
                              <th>× rate × share of year</th>
                              <th style={{ textAlign: 'right' }}>Fee</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.slices.map((s, i) => (
                              <tr key={i}>
                                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.from)}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.to)}</td>
                                <td>{s.basisKind}</td>
                                <td className="num">{fmt(s.basis)}</td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  × {pct(s.rate)} × {s.fractionWorking}
                                </td>
                                <td className="num">{fmt(s.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          <tr>
            <td style={{ fontWeight: 600 }} colSpan={2}>
              Total
            </td>
            <td className="num" style={{ fontWeight: 600 }}>
              {fmt(total)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0 }}>
        Open any investor to see how their fee was worked out.
      </p>
    </div>
  );
}

/**
 * What late investors paid for the time before they joined, closing by closing.
 *
 * Kept apart from the periods: a period counts an investor from the day they
 * joined, so this is not in any of them, and it is only the manager's fee
 * income when the terms give it to the manager.
 */
function CatchUpFees({ fundId, catchUps }: { fundId: string; catchUps: CatchUpFee[] }) {
  const people = (xs: { lpId: string; name: string; fee: number }[]) =>
    xs.map((x) => (
      <div key={x.lpId}>
        <span className="mono">{x.lpId}</span> {x.name} · {fmt(x.fee)}
      </div>
    ));
  return (
    <Card style={{ marginTop: 16 }} title="Catch-up fees from later closings" subtitle="the fee a late investor pays for the time before they joined">
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Closing</th>
              <th>Covers</th>
              <th>Paid by</th>
              <th>Goes to</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {catchUps.map((c) => (
              <tr key={c.closingId}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/funds/${fundId}/closings`} className="crumb" style={{ fontWeight: 600 }}>
                    Closing {c.closingNo}
                  </Link>
                  <div className="text-muted">{fmtDate(c.closingDate)}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(c.from)} – {fmtDate(c.to)}
                </td>
                <td>{people(c.paidBy)}</td>
                <td>
                  {c.recipient === 'manager' ? (
                    <Tag tone="accent">The manager</Tag>
                  ) : (
                    <>
                      <div className="text-muted">The investors already in</div>
                      {people(c.receivedBy)}
                    </>
                  )}
                </td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {fmt(c.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0, textWrap: 'pretty' }}>
        Worked out and fixed when the closing was finalised; the working is on Closings. Paid to the manager, it is fee
        income on top of the periods above. Paid to the investors already in, it only moves money between investors,
        and the manager&rsquo;s fee is unchanged.
      </p>
    </Card>
  );
}

'use client';

import { Fragment, useState } from 'react';
import { fmt, fmtDate, pct, type EqualizationLine, type EqualizationResult } from '@/engine';
import { Card } from '@/components/ui/card';
import { CheckList } from '@/components/ui/check-list';
import { Stat } from '@/components/ui/stat';
import { Tag } from '@/components/ui/tag';

/**
 * A later closing's equalization: what moved, the proof it ties, and for every
 * investor the working behind their figure.
 *
 * The working is the point. "LP07 owes 1,082,022.08" is a claim; the same line
 * opened up — each earlier call, its share, the days of interest, the fee
 * slices — is something an investor, or their auditor, can check by hand.
 */
export function EqualizationPanel({
  result,
  finalised,
  statementHref,
}: {
  result: EqualizationResult;
  finalised: boolean;
  /** The statement PDF for one investor. */
  statementHref: (lpId: string) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const t = result.totals;
  const late = result.lines.filter((l) => l.role !== 'earlier');
  const latePays = late.reduce((s, l) => s + Math.max(l.net, 0), 0);
  const failing = result.checks.filter((c) => c.level === 'fail').length;

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      <div className="stat-row">
        <Stat
          label="Late investors pay"
          value={fmt(latePays)}
          info="Capital for the calls they missed, interest for paying late, and the management fee since the first close."
        />
        <Stat
          label="Capital moved"
          value={fmt(t.moved)}
          info="Their commitment's share of every earlier call. It goes back to the investors who paid those calls."
        />
        <Stat
          label="Interest"
          value={fmt(t.interest)}
          info="Charged on each call's share from that call's due date to the closing date, at the fund's late-close rate."
        />
        <Stat
          label="Catch-up fee"
          value={fmt(t.catchUpFee)}
          info="The management fee the late investors would have paid had they been in from the first close."
        />
        <Stat
          label="Paid in, after the close"
          value={pct(t.paidInPct)}
          info="Of commitment, for the fund as a whole — and now for every late investor too."
        />
      </div>

      <Card title="Proof" subtitle={failing ? `${failing} failing` : 'everything ties'}>
        <CheckList checks={result.checks} />
      </Card>

      <Card
        title="By investor"
        subtitle={finalised ? `frozen when the closing was finalised` : `a preview: nothing is fixed until the closing is finalised`}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Investor</th>
                <th />
                <th style={{ textAlign: 'right' }}>Commitment</th>
                <th style={{ textAlign: 'right' }}>Capital</th>
                <th style={{ textAlign: 'right' }}>Interest</th>
                <th style={{ textAlign: 'right' }}>Catch-up fee</th>
                <th style={{ textAlign: 'right' }}>Pays / receives</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <Fragment key={l.lpId}>
                  <tr
                    className="clickable"
                    onClick={() => setOpen(open === l.lpId ? null : l.lpId)}
                    aria-expanded={open === l.lpId}
                  >
                    <td>
                      <span className="mono">{l.lpId}</span> {l.name}
                    </td>
                    <td>
                      <Tag tone={l.role === 'earlier' ? 'neutral' : 'accent'}>
                        {l.role === 'late' ? 'Late' : l.role === 'both' ? 'Increase' : 'Earlier'}
                      </Tag>
                    </td>
                    <td className="num">{fmt(l.commitment)}</td>
                    <td className="num">{money(l.capital)}</td>
                    <td className="num">{money(l.interest)}</td>
                    <td className="num">{money(l.catchUpFee)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {l.net > 0 ? `pays ${fmt(l.net)}` : l.net < 0 ? `receives ${fmt(-l.net)}` : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <a
                        href={statementHref(l.lpId)}
                        onClick={(e) => e.stopPropagation()}
                        className="crumb"
                        title={`${finalised ? 'Statement' : 'Draft statement'} for ${l.name}, as a PDF`}
                      >
                        Statement
                      </a>
                    </td>
                  </tr>
                  {open === l.lpId && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--muted)', padding: '12px 16px' }}>
                        <Working line={l} result={result} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0 }}>
          Open any line to see how it was worked out.
        </p>
      </Card>
    </div>
  );
}

/** A figure with its sign made plain: payments as they are, receipts in brackets. */
function money(n: number): string {
  return n === 0 ? '—' : fmt(n);
}

/** One investor's figure, taken apart: each call, then the fee. */
function Working({ line, result }: { line: EqualizationLine; result: EqualizationResult }) {
  const T = result.totals.commitmentsBefore;
  const N = result.totals.commitmentsNew;
  const late = line.role !== 'earlier';

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      <strong>How was this worked out?</strong>
      <table className="table working">
        <thead>
          <tr>
            <th>Call</th>
            <th>Due</th>
            <th style={{ textAlign: 'right' }}>Fund called</th>
            <th>Moved to late investors</th>
            <th style={{ textAlign: 'right' }}>{late ? 'Their share' : 'Their refund'}</th>
            <th>Interest</th>
            <th style={{ textAlign: 'right' }}>Interest</th>
          </tr>
        </thead>
        <tbody>
          {line.calls.map((c, i) => (
            <tr key={i}>
              <td className="mono">{String(c.callNo).padStart(2, '0')}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.dueDate)}</td>
              <td className="num">{fmt(c.called)}</td>
              <td className="mono" style={{ fontSize: 12 }}>
                {fmt(c.called)} × {fmt(N, 0)} / {fmt(T + N, 0)} = {fmt(c.moved)}
              </td>
              <td className="num">{money(c.capital)}</td>
              <td className="mono" style={{ fontSize: 12 }}>
                {c.capital > 0 && c.days > 0 && result.totals.interestRate
                  ? result.totals.interestBasis === 'compound'
                    ? `× ((1 + ${pct(result.totals.interestRate)})^(${c.days}/365) − 1)`
                    : `× ${pct(result.totals.interestRate)} × ${c.days}/365`
                  : c.interest < 0
                    ? 'their share of the interest'
                    : ''}
              </td>
              <td className="num">{money(c.interest)}</td>
            </tr>
          ))}
          {line.calls.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted">
                No calls were made before this close, so no capital moves for this investor.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {line.feeSlices.length > 0 && (
        <table className="table working">
          <thead>
            <tr>
              <th>Catch-up fee, from</th>
              <th>to</th>
              <th style={{ textAlign: 'right' }}>Basis</th>
              <th>× rate × share of year</th>
              <th style={{ textAlign: 'right' }}>Fee</th>
            </tr>
          </thead>
          <tbody>
            {line.feeSlices.map((s, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.from)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.to)}</td>
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

      <div className="mono" style={{ fontSize: 12 }}>
        {late
          ? `${fmt(line.capital)} capital + ${fmt(line.interest)} interest + ${fmt(line.catchUpFee)} catch-up fee = ${fmt(line.net)}`
          : `${fmt(-line.capital)} capital back${line.interest ? ` + ${fmt(-line.interest)} interest` : ''}${
              line.catchUpFee ? ` + ${fmt(-line.catchUpFee)} of the catch-up fee` : ''
            } = ${fmt(-line.net)} received`}
      </div>
    </div>
  );
}

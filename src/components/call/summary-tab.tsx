import Link from 'next/link';
import { fmt, splitCall, type ComputeResult } from '@/engine';
import type { CallDetail } from '@/adapters/storage/types';
import { Card, CardGrid } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { BAR_COLOUR, NOTICE_DISPLAY, noticeStatusFor } from './notice-status';

/**
 * Summary: what is being called, from whom, and whether it is safe to issue.
 *
 * The two footers of the first card answer the only questions worth asking at
 * this point — does it tie out, and how far have the notices got.
 */
export function SummaryTab({
  call,
  result,
  basePath,
}: {
  call: CallDetail;
  result: ComputeResult;
  basePath: string;
}) {
  const split = splitCall(result);
  const currency = call.model.setup.Reporting_Currency;

  const failing = result.checks.filter((c) => c.level === 'fail').length;
  const warnings = result.checks.filter((c) => c.level === 'warn').length;
  const passed = result.checks.filter((c) => c.level === 'ok').length;

  const active = result.rows.filter((r) => r.isActive);
  const sent = active.filter((r) => noticeStatusFor(call.notices, r.LP_ID) === 'sent').length;
  const approved = active.filter((r) => noticeStatusFor(call.notices, r.LP_ID) === 'approved').length;
  const draft = active.length - sent - approved;

  const largest = Math.max(...active.map((r) => r.total), 1);

  return (
    <>
      <CardGrid style={{ marginTop: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))' }}>
        <Card title="Call summary" subtitle={`${currency}`}>
          <dl className="kv" style={{ gridTemplateColumns: '1fr max-content', padding: '14px 16px' }}>
            <dt>Called against commitment</dt>
            <dd className="num">{fmt(split.againstCommitment)}</dd>

            <dt>Called outside commitment</dt>
            <dd className="num">{fmt(split.outsideCommitment)}</dd>

            <dt>Management fee net of offsets</dt>
            <dd className="num">{fmt(split.feeNet)}</dd>

            <dt className="total">Total amount called</dt>
            <dd className="num total">{fmt(split.total)}</dd>
          </dl>

          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', fontSize: 13 }}>
            <div className="text-muted">
              Unfunded {fmt(result.totals.openUCC)} → {fmt(result.totals.closingUCC)}
            </div>
            <div className="text-muted">
              Paid-in {fmt(result.totals.openPaid)} → {fmt(result.totals.closingPaid)}
            </div>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '12px 16px',
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 13,
            }}
          >
            <Tag tone="accent">{passed} passed</Tag>
            {warnings > 0 && <Tag tone="warn">{warnings} warnings</Tag>}
            {failing > 0 && <Tag tone="danger">{failing} failing</Tag>}
            <Link href={`${basePath}?tab=checks`} style={{ marginLeft: 'auto', fontSize: 12 }}>
              View checks ›
            </Link>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '12px 16px',
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 13,
            }}
          >
            <span style={failing > 0 ? { color: 'var(--destructive)' } : undefined}>
              {readiness({ failing, sent, approved, draft, total: active.length })}
            </span>
            <Link href={`${basePath}?tab=notices`} style={{ marginLeft: 'auto', fontSize: 12 }}>
              Open notices ›
            </Link>
          </div>
        </Card>

        <Card title="Purpose of call" subtitle="before allocation">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Line item</th>
                  <th>Basis</th>
                  <th>Commitment</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {call.model.components
                  .filter((c) => c.Component_ID)
                  .map((c, i) => {
                    const amount = result.totals.comps[i] ?? 0;
                    return (
                      <tr key={c.Component_ID}>
                        <td>{c.Component_Name}</td>
                        <td className="text-muted">{c.Allocation_Basis}</td>
                        <td className="text-muted">
                          {String(c.Reduces_Unfunded).toUpperCase() === 'Y' ? 'Inside' : 'Outside'}
                        </td>
                        <td className="num">{fmt(amount)}</td>
                        <td className="num text-muted">
                          {((amount / (split.total || 1)) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                <tr>
                  <td>Management fee, net of offsets</td>
                  <td className="text-muted">{result.fee.basis}</td>
                  <td className="text-muted">{result.fee.reduces ? 'Inside' : 'Outside'}</td>
                  <td className="num">{fmt(split.feeNet)}</td>
                  <td className="num text-muted">
                    {((split.feeNet / (split.total || 1)) * 100).toFixed(1)}%
                  </td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td colSpan={3}>Total</td>
                  <td className="num">{fmt(split.total)}</td>
                  <td className="num">100.0%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </CardGrid>

      <Card
        title="Allocation by investor"
        subtitle={`${active.length} active investors`}
        style={{ maxWidth: 1200, marginTop: 16 }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Investor</th>
                <th style={{ textAlign: 'right' }}>Commitment</th>
                <th style={{ textAlign: 'right' }}>Against commitment</th>
                <th style={{ textAlign: 'right' }}>Outside</th>
                <th style={{ textAlign: 'right' }}>Fee net</th>
                <th style={{ textAlign: 'right' }}>Total call</th>
                <th style={{ minWidth: 150 }}>Share of call</th>
                <th style={{ textAlign: 'right' }}>Unfunded after</th>
                <th>Notice</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const status = noticeStatusFor(call.notices, row.LP_ID);
                const againstCommitment =
                  row.reduces - (result.fee.reduces ? row.feeNet : 0);
                const outside = row.total - row.reduces - (result.fee.reduces ? 0 : row.feeNet);
                const share = (row.total / (split.total || 1)) * 100;

                return (
                  <tr key={row.LP_ID} style={{ opacity: row.isActive ? 1 : 0.45 }}>
                    <td className="mono">{row.LP_ID}</td>
                    <td>
                      <Link href={`${basePath}?tab=notices&lp=${row.LP_ID}`} style={{ textDecoration: 'none' }}>
                        {row.LP_Name}
                      </Link>
                      {!row.isActive && (
                        <span className="text-muted" style={{ fontSize: 11 }}> · {row.Status}</span>
                      )}
                    </td>
                    <td className="num">{fmt(Number(row.Commitment))}</td>
                    <td className="num">{fmt(againstCommitment)}</td>
                    <td className="num">{fmt(outside)}</td>
                    <td className="num">{fmt(row.feeNet)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmt(row.total)}</td>
                    <td>
                      {row.isActive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {/* Scaled against the largest investor, not the total,
                              so the smaller holdings stay visible. */}
                          <span
                            style={{
                              display: 'block',
                              height: 10,
                              width: `${Math.max(2, (row.total / largest) * 100)}%`,
                              background: BAR_COLOUR[status],
                              borderRadius: 2,
                            }}
                          />
                          <span className="num text-muted" style={{ fontSize: 11 }}>
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="num">{fmt(row.closingUCC)}</td>
                    <td>
                      {row.isActive && (
                        <Tag tone={NOTICE_DISPLAY[status].tone}>{NOTICE_DISPLAY[status].label}</Tag>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 600, borderTop: '1px solid var(--foreground)' }}>
                <td colSpan={2}>TOTAL</td>
                <td className="num">{fmt(result.totals.Commitment)}</td>
                <td className="num">{fmt(split.againstCommitment)}</td>
                <td className="num">{fmt(split.outsideCommitment)}</td>
                <td className="num">{fmt(result.totals.feeNet)}</td>
                <td className="num">{fmt(result.totals.total)}</td>
                <td />
                <td className="num">{fmt(result.totals.closingUCC)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** One sentence on whether this call can go out, and what is left to do. */
function readiness({
  failing,
  sent,
  approved,
  draft,
  total,
}: {
  failing: number;
  sent: number;
  approved: number;
  draft: number;
  total: number;
}): string {
  if (failing > 0) {
    return `${failing} check${failing === 1 ? '' : 's'} failing — resolve before issuing notices.`;
  }
  if (sent === total && total > 0) return `All ${total} notices sent.`;
  const parts = [`${sent} of ${total} notices sent`];
  if (approved) parts.push(`${approved} approved`);
  if (draft) parts.push(`${draft} in draft`);
  return parts.join(', ') + '.';
}

import Link from 'next/link';
import { fmt, fmtDate } from '@/engine';
import { Card } from '@/components/ui/card';

/** One column of the drawdown chart: what a single call drew. */
export interface DrawdownColumn {
  callNo: number;
  callDate: string | null;
  /** Where the call opens. */
  href: string;
  /** Its total. Null for a call with nothing entered yet. */
  total: number | null;
  againstCommitment: number;
  outsideCommitment: number;
  feeNet: number;
  /** Everything called up to and including this call — a draft adds nothing. */
  cumulative: number;
  /** Not sent yet, so nothing is called: drawn as a dashed outline, at its size once it has one. */
  draft: boolean;
}

const CHART_HEIGHT = 150;
/** The least a part that is not nothing is drawn at, so a small amount is still seen. */
const MIN_SEGMENT = 3;

/**
 * Amount called per notice, as stacked columns.
 *
 * Deliberately hand-drawn rather than pulled from a charting library: the spec
 * needs three stacked segments scaled against the tallest call, a dashed
 * outline for a call that has not been computed, and a mount animation — which
 * is a handful of divs, and less code than configuring a library to do exactly
 * that.
 *
 * Each column is also a table row to a screen reader, via the caption and the
 * text beneath it; the bars are decorative and marked as such.
 */
export function DrawdownChart({
  columns,
  totalCommitments,
  currency,
}: {
  columns: DrawdownColumn[];
  totalCommitments: number;
  currency: string;
}) {
  const tallest = Math.max(...columns.map((c) => c.total ?? 0), 1);
  const issued = columns.filter((c) => !c.draft);
  const drafts = columns.some((c) => c.draft);
  // Every call measured against today's commitments, as the legend is: a later
  // close adds commitments, and measuring each call against the total at the
  // time made a cumulative share appear to fall.
  const pctOf = (called: number) => (totalCommitments > 0 ? (called / totalCommitments) * 100 : 0);
  const calledPct = issued.length ? pctOf(issued[issued.length - 1].cumulative) : 0;

  return (
    <Card
      title="Drawdown history"
      subtitle="amount called per notice · cumulative % of commitments called"
      style={{ maxWidth: 1200, marginTop: 16 }}
    >
      <div
        style={{
          padding: '20px 16px 14px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 200px',
          gap: 24,
          alignItems: 'end',
        }}
      >
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
          {columns.map((c) => {
            const scale = (v: number) => (v > 0 ? Math.max(MIN_SEGMENT, Math.round((v / tallest) * CHART_HEIGHT)) : 0);
            return (
              <Link
                key={c.callNo}
                href={c.href}
                className="dd-col"
                aria-label={describe(c, pctOf(c.cumulative), currency)}
                style={{
                  position: 'relative',
                  color: 'inherit',
                  textDecoration: 'none',
                  flex: 1,
                  minWidth: 0,
                  maxWidth: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  // A draft is shown faintly: nothing has been called yet.
                  opacity: c.draft ? 0.7 : 1,
                }}
              >
                <div
                  className="num"
                  style={{
                    textAlign: 'center',
                    fontSize: 11,
                    color: 'var(--muted-foreground)',
                    marginBottom: 6,
                  }}
                >
                  {c.total === null ? 'not started' : fmt(c.total, 0)}
                </div>

                <div
                  // A fixed height for every column's bars, so all of them stand on
                  // one baseline whatever the label above or the caption below.
                  style={{ height: CHART_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                  aria-hidden="true"
                >
                  {c.draft ? (
                    <div
                      style={{
                        height: c.total ? Math.max(scale(c.total), 4) : CHART_HEIGHT * 0.6,
                        border: '1.5px dashed var(--muted-foreground)',
                        borderRadius: 3,
                      }}
                    />
                  ) : (
                    <>
                      <div
                        className="bar-seg"
                        style={{ height: scale(c.feeNet), background: 'var(--chart-5)' }}
                      />
                      <div
                        className="bar-seg"
                        style={{ height: scale(c.outsideCommitment), background: 'var(--chart-1)' }}
                      />
                      <div
                        className="bar-seg"
                        style={{
                          height: scale(c.againstCommitment),
                          background: 'var(--chart-2)',
                          borderRadius: '0 0 3px 3px',
                        }}
                      />
                    </>
                  )}
                </div>

                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    marginTop: 8,
                    paddingTop: 8,
                    textAlign: 'center',
                    fontSize: 12,
                  }}
                >
                  Call {String(c.callNo).padStart(2, '0')}
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {c.draft ? 'draft, not sent' : `${pctOf(c.cumulative).toFixed(1)}% called`}
                  </div>
                </div>
                <Breakdown column={c} pct={pctOf(c.cumulative)} currency={currency} />
              </Link>
            );
          })}
        </div>

        <div style={{ display: 'grid', gap: 8, fontSize: 12, paddingBottom: 36 }}>
          <LegendSwatch color="var(--chart-2)">Against commitment</LegendSwatch>
          <LegendSwatch color="var(--chart-1)">Outside commitment</LegendSwatch>
          <LegendSwatch color="var(--chart-5)">Management fee, net</LegendSwatch>
          {drafts && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  border: '1.5px dashed var(--muted-foreground)',
                  boxSizing: 'border-box',
                }}
              />
              Draft, not sent yet
            </div>
          )}
          <div className="text-muted" style={{ marginTop: 6 }}>
            {calledPct.toFixed(1)}% of {currency} {fmt(totalCommitments, 0)} called across{' '}
            {issued.length} {issued.length === 1 ? 'call' : 'calls'}.
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The column in words, for a screen reader and as the link's name. */
function describe(c: DrawdownColumn, pct: number, currency: string): string {
  if (c.total === null) return `Call ${c.callNo}: nothing entered yet. Open to set it up.`;
  const amounts = `${currency} ${fmt(c.total)}: ${fmt(c.againstCommitment)} against commitment, ${fmt(c.outsideCommitment)} outside commitment, ${fmt(c.feeNet)} management fee`;
  return c.draft
    ? `Call ${c.callNo}, draft, not sent: ${amounts}. Nothing called yet.`
    : `Call ${c.callNo}${c.callDate ? `, ${fmtDate(c.callDate)}` : ''}: ${amounts}. ${pct.toFixed(1)}% of commitments called to date.`;
}

/** What a column is made of, shown on hover or focus. */
function Breakdown({ column: c, pct, currency }: { column: DrawdownColumn; pct: number; currency: string }) {
  const row = (label: string, value: number, color?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && <span style={{ width: 8, height: 8, background: color, flex: 'none' }} />}
        {label}
      </span>
      <span className="num">{value ? fmt(value) : '—'}</span>
    </div>
  );
  return (
    <div className="dd-tip" aria-hidden="true">
      <strong style={{ display: 'block', marginBottom: 6 }}>
        Call {String(c.callNo).padStart(2, '0')}
        {c.callDate ? ` · ${fmtDate(c.callDate)}` : ''}
        {c.draft ? ' · draft, not sent' : ''}
      </strong>
      {c.total === null ? (
        <div className="text-muted">Nothing entered yet.</div>
      ) : (
        <>
          {row('Against commitment', c.againstCommitment, 'var(--chart-2)')}
          {row('Outside commitment', c.outsideCommitment, 'var(--chart-1)')}
          {row('Management fee, net', c.feeNet, 'var(--chart-5)')}
          <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0 4px' }} />
          {row(`Total, ${currency}`, c.total)}
          <div className="text-muted" style={{ marginTop: 4 }}>
            {c.draft ? 'Nothing called until it is sent.' : `${fmt(c.cumulative)} called to date · ${pct.toFixed(1)}% of commitments`}
          </div>
        </>
      )}
      <div className="text-muted" style={{ marginTop: 6 }}>Click to open the call.</div>
    </div>
  );
}

function LegendSwatch({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ width: 10, height: 10, background: color }} />
      {children}
    </div>
  );
}

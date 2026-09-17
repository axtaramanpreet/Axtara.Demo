import { fmt } from '@/engine';
import { Card } from '@/components/ui/card';

/** One column of the drawdown chart: what a single call drew. */
export interface DrawdownColumn {
  callNo: number;
  /** Total called. Null for a call that has not been computed yet. */
  total: number | null;
  againstCommitment: number;
  outsideCommitment: number;
  feeNet: number;
  /** Cumulative share of commitments drawn after this call. */
  cumulativePct: number;
  /** A call with nothing allocated yet, drawn as a dashed outline. */
  planned: boolean;
}

const CHART_HEIGHT = 150;

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
  const issued = columns.filter((c) => !c.planned);
  const drawnPct = issued.length ? issued[issued.length - 1].cumulativePct : 0;

  return (
    <Card
      title="Drawdown history"
      subtitle="amount called per notice · cumulative % of commitments drawn"
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
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', height: 190 }}>
          {columns.map((c) => {
            const scale = (v: number) => Math.round((v / tallest) * CHART_HEIGHT);
            const height = c.total ? scale(c.total) : 0;
            return (
              <div
                key={c.callNo}
                style={{
                  flex: 1,
                  minWidth: 0,
                  maxWidth: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  height: '100%',
                  // A planned call is shown faintly: it is a placeholder, not a fact.
                  opacity: c.planned ? 0.55 : 1,
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
                  {c.total === null ? 'planned' : fmt(c.total, 0)}
                </div>

                <div
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                  aria-hidden="true"
                >
                  {c.planned ? (
                    <div
                      style={{
                        height: CHART_HEIGHT * 0.6,
                        border: '1.5px dashed var(--border)',
                        borderRadius: 3,
                      }}
                    />
                  ) : (
                    <>
                      <div
                        className="bar-seg"
                        style={{ height: scale(c.feeNet), background: 'var(--chart-5)' }}
                        title="Management fee, net"
                      />
                      <div
                        className="bar-seg"
                        style={{ height: scale(c.outsideCommitment), background: 'var(--chart-1)' }}
                        title="Outside commitment"
                      />
                      <div
                        className="bar-seg"
                        style={{
                          height: scale(c.againstCommitment),
                          background: 'var(--chart-2)',
                          borderRadius: '0 0 3px 3px',
                        }}
                        title="Against commitment"
                      />
                      <div style={{ height: Math.max(0, CHART_HEIGHT - height) }} />
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
                    {c.planned ? 'planned' : `${c.cumulativePct.toFixed(1)}% drawn`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gap: 8, fontSize: 12, paddingBottom: 36 }}>
          <LegendSwatch color="var(--chart-2)">Against commitment</LegendSwatch>
          <LegendSwatch color="var(--chart-1)">Outside commitment</LegendSwatch>
          <LegendSwatch color="var(--chart-5)">Management fee, net</LegendSwatch>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                width: 10,
                height: 10,
                border: '1.5px dashed var(--border)',
                boxSizing: 'border-box',
              }}
            />
            Planned, not yet allocated
          </div>
          <div className="text-muted" style={{ marginTop: 6 }}>
            {drawnPct.toFixed(1)}% of {currency} {fmt(totalCommitments, 0)} drawn across{' '}
            {issued.length} {issued.length === 1 ? 'call' : 'calls'}.
          </div>
        </div>
      </div>
    </Card>
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

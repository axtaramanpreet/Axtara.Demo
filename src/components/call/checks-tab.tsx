import type { CheckLevel, ComputeResult } from '@/engine';
import { Card } from '@/components/ui/card';

const LEVEL: Record<CheckLevel, { label: string; colour: string }> = {
  ok: { label: 'OK', colour: 'var(--chart-2)' },
  warn: { label: 'WARN', colour: 'var(--chart-1)' },
  fail: { label: 'FAIL', colour: 'var(--destructive)' },
  info: { label: 'INFO', colour: 'var(--muted-foreground)' },
};

/**
 * Every tie-out the engine ran, in the order it ran them.
 *
 * Passing checks are shown, not hidden behind a filter: an accountant signing
 * off a call wants to see that the allocation ties and the roll-forwards
 * balance, not merely that nothing complained.
 */
export function ChecksTab({ result, goldenSource }: { result: ComputeResult; goldenSource?: string }) {
  const failing = result.checks.filter((c) => c.level === 'fail').length;

  return (
    <div style={{ maxWidth: 1200, marginTop: 20, display: 'grid', gap: 16 }}>
      <Card
        title="Tie-out checks"
        subtitle={failing ? `${failing} failing` : 'all clear'}
      >
        <div>
          {result.checks.map((check, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                gap: 12,
                padding: '9px 16px',
                borderBottom: i === result.checks.length - 1 ? 0 : '1px solid var(--border)',
                fontSize: 13,
                alignItems: 'baseline',
              }}
            >
              <span
                className="mono"
                style={{ color: LEVEL[check.level].colour, fontWeight: 500 }}
              >
                {LEVEL[check.level].label}
              </span>
              <span>{check.text}</span>
            </div>
          ))}
        </div>
      </Card>

      {result.goldenDiffs.length > 0 && (
        <Card
          title="Differences from Expected_Output"
          subtitle={goldenSource}
        >
          <table className="table">
            <thead>
              <tr>
                <th>LP</th>
                <th>Field</th>
                <th style={{ textAlign: 'right' }}>Expected</th>
                <th style={{ textAlign: 'right' }}>Engine</th>
              </tr>
            </thead>
            <tbody>
              {result.goldenDiffs.map((d, i) => (
                <tr key={i}>
                  <td className="mono">{d.lp}</td>
                  <td className="mono">{d.field}</td>
                  <td className="num">{d.expected}</td>
                  <td className="num" style={{ color: 'var(--destructive)' }}>
                    {d.actual}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

import type { ComputeResult } from '@/engine';
import { CheckList } from '@/components/ui/check-list';
import { Card } from '@/components/ui/card';

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
        <CheckList checks={result.checks} />
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

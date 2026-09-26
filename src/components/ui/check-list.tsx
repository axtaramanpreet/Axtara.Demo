import type { CheckLevel } from '@/engine';

const LEVEL: Record<CheckLevel, { label: string; colour: string }> = {
  ok: { label: 'OK', colour: 'var(--chart-2)' },
  warn: { label: 'WARN', colour: 'var(--chart-1)' },
  fail: { label: 'FAIL', colour: 'var(--destructive)' },
  info: { label: 'INFO', colour: 'var(--muted-foreground)' },
};

/**
 * A list of checks, OK to FAIL, in the order they were run.
 *
 * Passing checks are shown, not hidden: someone signing off wants to see that
 * a thing ties, not merely that nothing complained. Shared by a call's tie-out
 * checks and a closing's equalization, so the two read the same.
 */
export function CheckList({ checks }: { checks: { level: CheckLevel; text: string }[] }) {
  return (
    <div>
      {checks.map((check, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr',
            gap: 12,
            padding: '9px 16px',
            borderBottom: i === checks.length - 1 ? 0 : '1px solid var(--border)',
            fontSize: 13,
            alignItems: 'baseline',
          }}
        >
          <span className="mono" style={{ color: LEVEL[check.level].colour, fontWeight: 500 }}>
            {LEVEL[check.level].label}
          </span>
          <span>{check.text}</span>
        </div>
      ))}
    </div>
  );
}

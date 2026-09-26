import Link from 'next/link';
import { Card } from './card';

/**
 * A step that is not open yet: what it is, what comes first, and the way there.
 * Shown in place of a screen whose inputs do not exist yet.
 */
export function StepGate({
  title,
  what,
  reason,
  href,
  action,
}: {
  title: string;
  /** What this step does, once open. */
  what: string;
  /** Why it is not open yet. From `fundGates`. */
  reason: string;
  href: string;
  action: string;
}) {
  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>{title}</h1>
      <Card style={{ marginTop: 24, maxWidth: 640 }} bodyPadding="24px">
        <h3 style={{ marginTop: 0 }}>Not open yet</h3>
        <p className="text-muted" style={{ textWrap: 'pretty' }}>{what}</p>
        <p style={{ textWrap: 'pretty' }}>{reason}</p>
        <Link className="btn btn-primary" href={href}>
          {action}
        </Link>
      </Card>
    </div>
  );
}

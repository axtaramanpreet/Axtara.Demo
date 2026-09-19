import { fundCode } from '@/lib/fund-code';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

/**
 * A module that is named in the sidebar but not built.
 *
 * It exists so the nav can be honest: the shape of the product is wider than
 * capital calls, and a greyed-out row that does nothing at all reads as broken
 * rather than as forthcoming. This says which it is.
 */
export function ModulePlaceholder({
  fundName,
  title,
  text,
  backHref,
}: {
  fundName: string;
  title: string;
  text: string;
  backHref: string;
}) {
  return (
    <div className="placeholder">
      <span className="ws-tile">{fundCode(fundName)}</span>
      <h1>{title}</h1>
      <p className="text-muted" style={{ textWrap: 'pretty', marginTop: 10 }}>
        {text}
      </p>
      <div style={{ marginTop: 20 }}>
        <Link href={backHref}>
          <Button variant="secondary">Back to capital calls</Button>
        </Link>
      </div>
    </div>
  );
}

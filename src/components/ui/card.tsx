import type { CSSProperties, ReactNode } from 'react';

/**
 * A bordered surface with an optional titled header.
 *
 * `overflow: hidden` on the card is what lets a table sit flush inside it
 * without its header background escaping the rounded corners.
 */
export function Card({
  title,
  subtitle,
  children,
  style,
  bodyPadding,
}: {
  title?: ReactNode;
  /** Muted text on the right of the header — a count, a date, a caveat. */
  subtitle?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  /** Padding for the body. Omit for flush content such as a table. */
  bodyPadding?: string;
}) {
  return (
    <section className="card" style={style}>
      {title !== undefined && (
        <div className="card-h">
          <span>{title}</span>
          {subtitle !== undefined && <small>{subtitle}</small>}
        </div>
      )}
      {bodyPadding ? <div style={{ padding: bodyPadding }}>{children}</div> : children}
    </section>
  );
}

/**
 * The page's card grid: columns at least 620px wide, collapsing to one on
 * narrow screens. `min(100%, 620px)` is what stops the grid overflowing rather
 * than wrapping when the viewport is under 620px.
 *
 * 620 rather than the handoff's 560 because the handoff had no sidebar. With
 * 232px taken off the left, two 560px columns still fit at 1440 — but only just,
 * and the calls table needs ~600, so its last column sat past the edge of its
 * own card. The table could be scrolled sideways to reach it, which on a
 * trackpad means it simply looked cut off.
 */
export function CardGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 620px), 1fr))',
        gap: 16,
        maxWidth: 1200,
        alignItems: 'start',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

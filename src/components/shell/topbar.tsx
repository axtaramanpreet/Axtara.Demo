'use client';

import Link from 'next/link';
import { ThemeIconButton, useRail } from '@/components/theme';
import { PanelIcon } from './icons';

/** Where you are, as the top bar says it. */
export interface Crumb {
  /** The module, shown only when you are inside something. */
  module?: { label: string; href: string };
  /** The page itself. */
  leaf: string;
}

/**
 * The top bar.
 *
 * It says where you are and offers the three things that are true on every
 * screen: collapse the sidebar, ask a question, change the theme. Nothing about
 * the current screen lives here — that belongs to the screen.
 */
export function TopBar({
  fundName,
  crumb,
  userInitials,
  askTrigger,
}: {
  fundName: string;
  crumb: Crumb;
  /** Initials of whoever prepared the call, from the register. */
  userInitials: string;
  /** The Ask Axtara button, which owns the panel it opens. */
  askTrigger: React.ReactNode;
}) {
  const { rail, setRail } = useRail();

  return (
    <div className="topbar" data-noprint="1">
      <button
        type="button"
        className="icon-btn"
        title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={rail}
        onClick={() => setRail(!rail)}
      >
        <PanelIcon />
      </button>

      <nav className="crumb" aria-label="Breadcrumb">
        <span>{fundName}</span>
        <i>/</i>
        {crumb.module && (
          <>
            <Link href={crumb.module.href} style={{ color: 'var(--muted-foreground)', textDecoration: 'none' }}>
              {crumb.module.label}
            </Link>
            <i>/</i>
          </>
        )}
        <b>{crumb.leaf}</b>
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {askTrigger}
        <ThemeIconButton />
        <span className="avatar" title="Signed in">
          {userInitials}
        </span>
      </div>
    </div>
  );
}

/**
 * Initials for the avatar.
 *
 * `Prepared_By` is a name typed into a spreadsheet, so it can be anything or
 * nothing; two letters is all the circle holds either way.
 */
export function initialsOf(preparedBy?: string | null): string {
  return (preparedBy?.trim() || 'Fund Admin')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

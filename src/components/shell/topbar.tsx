'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { Fund } from '@/adapters/storage/types';
import { fundCode } from '@/lib/fund-code';
import { useDismiss } from '@/lib/hooks/use-dismiss';
import { ThemeIconButton, useRail } from '@/components/theme';
import { NewFundDialog } from '@/components/home/new-fund-dialog';
import { ChevronDown, PanelIcon } from './icons';

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
 * Which fund you are in — and a switch to any other of the client's funds, or
 * a new one — then where you are inside it. Beside that, the three things true
 * on every screen: collapse the sidebar, ask a question, change the theme.
 */
export function TopBar({
  funds,
  fundId,
  callCount,
  crumb,
  userInitials,
  askTrigger,
}: {
  funds: Fund[];
  fundId: string;
  /** How many calls this fund has, said on the switcher. */
  callCount: number;
  crumb: Crumb;
  /** Initials of whoever prepared the call, from the register. */
  userInitials: string;
  /** The Ask Axtara button, which owns the panel it opens. */
  askTrigger: React.ReactNode;
}) {
  const { rail, setRail } = useRail();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrapper, trigger);

  const current = funds.find((f) => f.id === fundId);
  const name = current?.name ?? 'Fund';
  // The client's funds only: another client is switched to in the sidebar.
  const siblings = funds.filter((f) => f.clientId === current?.clientId);

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

      <div className="fund-switch" ref={wrapper}>
        <button
          ref={trigger}
          type="button"
          className="fund-switch-btn"
          title={`${name} · ${callCount} capital call${callCount === 1 ? '' : 's'} · switch fund`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <b>{name}</b>
          <span className="fund-tag">Fund</span>
          <ChevronDown />
        </button>
        {open && (
          <div className="ws-menu fund-menu" role="menu" aria-label="Funds">
            {siblings.map((f) => (
              <Link
                key={f.id}
                role="menuitem"
                href={`/funds/${f.id}`}
                className={['ws-item', f.id === fundId ? 'on' : ''].filter(Boolean).join(' ')}
                onClick={close}
              >
                <span className="ws-tile">{fundCode(f.name)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
              </Link>
            ))}
            <div className="ws-sep" />
            <button
              type="button"
              role="menuitem"
              className="ws-item add"
              onClick={() => {
                close();
                setCreating(true);
              }}
            >
              <span style={{ width: 26, textAlign: 'center', fontSize: 16, lineHeight: 1 }}>+</span>
              New fund
            </button>
          </div>
        )}
      </div>

      <nav className="crumb" aria-label="Breadcrumb">
        {crumb.module && (
          <>
            <i>/</i>
            <Link href={crumb.module.href} style={{ color: 'var(--muted-foreground)', textDecoration: 'none' }}>
              {crumb.module.label}
            </Link>
          </>
        )}
        <i>/</i>
        <b>{crumb.leaf}</b>
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {askTrigger}
        <ThemeIconButton />
        <span className="avatar" title="Signed in">
          {userInitials}
        </span>
      </div>

      {creating && (
        <NewFundDialog
          existingNames={siblings.map((f) => f.name)}
          clientId={current?.clientId}
          onClose={() => setCreating(false)}
        />
      )}
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

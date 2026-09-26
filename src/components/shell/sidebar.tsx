'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Fund } from '@/adapters/storage/types';
import { fundCode } from '@/lib/fund-code';
import { BrandMark, Wordmark } from '@/components/ui/wordmark';
import { NewFundDialog } from '@/components/home/new-fund-dialog';
import { CallsIcon, ChevronDown, InvestorsIcon, SettingsIcon, ClosingsIcon, FeesIcon, LockIcon } from './icons';
import { NO_GATES, type FundGates } from '@/lib/fund-gates';

/** Which sidebar entry is lit. */
export type Module = 'capital-calls' | 'closings' | 'fees' | 'investors' | 'settings';

/**
 * The sidebar.
 *
 * Which fund, then what you can do inside it. The fund switcher is at the top
 * rather than in the page because a capital call belongs to exactly one fund,
 * and switching fund is switching everything below it.
 *
 * A step not open yet stays in the list, dimmed and locked, with the reason
 * on hover: its page says what comes first.
 */
export function Sidebar({
  funds,
  fundId,
  module,
  callCount,
  gates = NO_GATES,
}: {
  funds: Fund[];
  fundId: string;
  module: Module;
  /** How many calls this fund has, shown under its name. */
  callCount: number;
  /** Which steps are not open yet, and why. */
  gates?: FundGates;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const current = funds.find((c) => c.id === fundId);
  const name = current?.name ?? 'Fund';

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <aside className="side" data-noprint="1">
      <div className="ws" ref={wrapper}>
        <button
          ref={trigger}
          type="button"
          className="ws-btn"
          title="Switch fund"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ws-tile">{fundCode(name)}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <b>{name}</b>
            <small>
              {callCount} capital call{callCount === 1 ? '' : 's'}
            </small>
          </span>
          <ChevronDown />
        </button>

        {open && (
          <div className="ws-menu" role="menu">
            {funds.map((c) => (
              <Link
                key={c.id}
                role="menuitem"
                href={`/funds/${c.id}`}
                className={['ws-item', c.id === fundId ? 'on' : ''].filter(Boolean).join(' ')}
                onClick={() => setOpen(false)}
              >
                <span className="ws-tile">{fundCode(c.name)}</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </span>
              </Link>
            ))}
            <div className="ws-sep" />
            <button
              type="button"
              role="menuitem"
              className="ws-item add"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <span style={{ width: 22, textAlign: 'center', fontSize: 16, lineHeight: 1 }}>+</span>
              New fund
            </button>
          </div>
        )}
      </div>

      {creating && <NewFundDialog existingNames={funds.map((f) => f.name)} onClose={() => setCreating(false)} />}

      {/* In the order a new fund is set up and then run: its terms, its
          investors, who committed at each close, then the calls and fees. */}
      <div className="nav-group">Set up</div>
      <NavItem href={`/funds/${fundId}/settings`} on={module === 'settings'} icon={<SettingsIcon />} label="Fund terms" title="Fund terms — from the LPA" />
      <NavItem href={`/funds/${fundId}/investors`} on={module === 'investors'} icon={<InvestorsIcon />} label="Investors" title="Investors — the fund's register" />
      <NavItem href={`/funds/${fundId}/closings`} on={module === 'closings'} icon={<ClosingsIcon />} label="Closings" title="Closings and equalization" locked={gates.closings} />

      <div className="nav-group">Operations</div>
      <NavItem href={`/funds/${fundId}`} on={module === 'capital-calls'} icon={<CallsIcon />} label="Capital calls" title="Capital calls" locked={gates.calls} />
      <NavItem href={`/funds/${fundId}/fees`} on={module === 'fees'} icon={<FeesIcon />} label="Management fees" title="Management fees" locked={gates.fees} />

      <div className="side-foot">
        {/* The one brand mark in the product. The handoff put "Fund
            administration" beside it; with the real wordmark there the two
            sat awkwardly, and the mark says enough on its own. Collapsed to a
            rail there is no room for six letters and the diamond stands in. */}
        <div className="side-brand">
          <BrandMark />
          <Wordmark height={16} />
        </div>
      </div>
    </aside>
  );
}

/**
 * One entry. A locked one is still a link — its page says what comes first and
 * links back to it — but reads as not open yet.
 */
function NavItem({
  href,
  on,
  icon,
  label,
  title,
  locked,
}: {
  href: string;
  on: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  locked?: string | null;
}) {
  return (
    <Link
      href={href}
      className={['nav-item', on ? 'on' : '', locked ? 'dim' : ''].filter(Boolean).join(' ')}
      title={locked ? `${title} — ${locked}` : title}
    >
      {icon}
      <span>{label}</span>
      {locked && <LockIcon />}
    </Link>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { Fund } from '@/adapters/storage/types';
import { fundCode } from '@/lib/fund-code';
import { useDismiss } from '@/lib/hooks/use-dismiss';
import { BrandMark, Wordmark } from '@/components/ui/wordmark';
import { CallsIcon, ChevronUpDown, InvestorsIcon, SettingsIcon, ClosingsIcon, FeesIcon, LockIcon } from './icons';
import { NO_GATES, type FundGates } from '@/lib/fund-gates';

/** Which sidebar entry is lit. */
export type Module = 'capital-calls' | 'closings' | 'fees' | 'investors' | 'settings';

/** The clients the user can work in, each with its funds, from the fund list. */
export function clientsOf(funds: Fund[]) {
  const byId = new Map<string, { id: string; name: string; funds: Fund[] }>();
  for (const f of funds) {
    const c = byId.get(f.clientId) ?? { id: f.clientId, name: f.clientName, funds: [] };
    c.funds.push(f);
    byId.set(f.clientId, c);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The sidebar.
 *
 * The product at the top, then who you are working for — the client — then
 * what you can do in the fund. The fund itself is chosen in the top bar: it
 * changes often, and the client rarely.
 *
 * A step not open yet stays in the list, dimmed and locked, with the reason
 * on hover: its page says what comes first.
 */
export function Sidebar({
  funds,
  fundId,
  module,
  gates = NO_GATES,
}: {
  funds: Fund[];
  fundId: string;
  module: Module;
  /** Which steps are not open yet, and why. */
  gates?: FundGates;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrapper, trigger);

  const clients = clientsOf(funds);
  const current = clients.find((c) => c.funds.some((f) => f.id === fundId)) ?? clients[0];
  const name = current?.name || 'Client';
  const summary = current ? `${current.funds.length} fund${current.funds.length === 1 ? '' : 's'}` : '';

  return (
    <aside className="side" data-noprint="1">
      {/* The one brand mark in the product, where the eye starts. Collapsed to
          a rail there is no room for the letters, and the diamond stands in. */}
      <Link href="/" className="side-brand" aria-label="Axtara home">
        <BrandMark />
        <Wordmark height={21} />
      </Link>

      <div className="ws" ref={wrapper}>
        <button
          ref={trigger}
          type="button"
          className="ws-btn"
          title="Switch client"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ws-tile">{fundCode(name)}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <b>{name}</b>
            <small>Client · {summary}</small>
          </span>
          <ChevronUpDown />
        </button>

        {open && (
          <div className="ws-menu" role="menu" aria-label="Clients">
            {clients.map((c) => (
              <Link
                key={c.id}
                role="menuitem"
                href={`/funds/${c.funds[0].id}`}
                className={['ws-item', c.id === current?.id ? 'on' : ''].filter(Boolean).join(' ')}
                aria-current={c.id === current?.id || undefined}
                onClick={close}
              >
                <span className="ws-tile">{fundCode(c.name)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </span>
                <small>
                  {c.funds.length} fund{c.funds.length === 1 ? '' : 's'}
                </small>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* In the order a new fund is set up and then run: its terms, its
          investors, who committed at each close, then the calls and fees. */}
      <div className="nav-group">Set up</div>
      <NavItem href={`/funds/${fundId}/settings`} on={module === 'settings'} icon={<SettingsIcon />} label="Fund terms" title="Fund terms — from the LPA" />
      <NavItem href={`/funds/${fundId}/investors`} on={module === 'investors'} icon={<InvestorsIcon />} label="Investors" title="Investors — the fund's register" />
      <NavItem href={`/funds/${fundId}/closings`} on={module === 'closings'} icon={<ClosingsIcon />} label="Closings" title="Closings and equalization" locked={gates.closings} />

      <div className="nav-group">Operations</div>
      <NavItem href={`/funds/${fundId}`} on={module === 'capital-calls'} icon={<CallsIcon />} label="Capital calls" title="Capital calls" locked={gates.calls} />
      <NavItem href={`/funds/${fundId}/fees`} on={module === 'fees'} icon={<FeesIcon />} label="Management fees" title="Management fees" locked={gates.fees} />

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

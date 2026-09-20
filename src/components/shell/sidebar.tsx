'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { Client } from '@/adapters/storage/types';
import { fundCode } from '@/lib/fund-code';
import { BrandMark, Wordmark } from '@/components/ui/wordmark';
import { CallsIcon, ChevronDown, ChevronRight, InvestorsIcon, SettingsIcon } from './icons';

/** Which sidebar entry is lit. */
export type Module = 'capital-calls' | 'investors' | 'settings';

/**
 * The sidebar.
 *
 * Which fund, then what you can do inside it. The fund switcher is at the top
 * rather than in the page because a capital call belongs to exactly one fund,
 * and switching fund is switching everything below it.
 *
 * "Soon" entries are honest rather than hidden: the page they open says what is
 * coming, which is better than a nav that pretends the product is finished.
 */
export function Sidebar({
  clients,
  clientId,
  module,
  callCount,
}: {
  clients: Client[];
  clientId: string;
  module: Module;
  /** How many calls this fund has, shown under its name. */
  callCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const current = clients.find((c) => c.id === clientId);
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

  async function onNewClient() {
    setOpen(false);
    const asked = window.prompt('Name of the new fund');
    if (!asked?.trim()) return;

    setError(null);
    try {
      const repo = createSupabaseRepository(createBrowserSupabase());
      const created = await repo.createClient(asked.trim());
      startTransition(() => {
        router.push(`/clients/${created.id}`);
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the fund.');
    }
  }

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
          disabled={pending}
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
            {clients.map((c) => (
              <Link
                key={c.id}
                role="menuitem"
                href={`/clients/${c.id}`}
                className={['ws-item', c.id === clientId ? 'on' : ''].filter(Boolean).join(' ')}
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
            <button type="button" role="menuitem" className="ws-item add" onClick={onNewClient}>
              <span style={{ width: 22, textAlign: 'center', fontSize: 16, lineHeight: 1 }}>+</span>
              New client
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--destructive)', fontSize: 12, padding: '0 10px' }}>
          {error}
        </p>
      )}

      <div className="nav-group">Fund operations</div>
      <Link
        href={`/clients/${clientId}`}
        className={['nav-item', module === 'capital-calls' ? 'on' : ''].filter(Boolean).join(' ')}
        title="Capital calls"
      >
        <CallsIcon />
        <span>Capital calls</span>
        <ChevronRight className="chev" />
      </Link>

      <div className="nav-group">Administration</div>
      <SoonItem
        href={`/clients/${clientId}/investors`}
        label="Investors"
        on={module === 'investors'}
        icon={<InvestorsIcon />}
        chevron
      />
      <SoonItem
        href={`/clients/${clientId}/settings`}
        label="Settings"
        on={module === 'settings'}
        icon={<SettingsIcon />}
      />

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

/** A nav entry for a module that is named but not built. */
function SoonItem({
  href,
  label,
  on,
  icon,
  chevron,
}: {
  href: string;
  label: string;
  on: boolean;
  icon: React.ReactNode;
  chevron?: boolean;
}) {
  return (
    <Link
      href={href}
      className={['nav-item', 'dim', on ? 'on' : ''].filter(Boolean).join(' ')}
      title={`${label} — not built yet`}
    >
      {icon}
      <span>{label}</span>
      <em className="soon">Soon</em>
      {chevron && <ChevronRight className="chev" />}
    </Link>
  );
}

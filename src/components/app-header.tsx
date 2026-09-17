'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { Client } from '@/adapters/storage/types';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';

/**
 * The header on every view: which fund you are looking at, on the left; the
 * assistant and the theme on the right.
 *
 * There is deliberately no global tab bar. Navigation is the fund picker plus
 * breadcrumbs, because a capital call is a place you go into and come back out
 * of rather than a tab you leave open.
 */
export function AppHeader({
  clients,
  currentClientId,
}: {
  clients: Client[];
  currentClientId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSelect(clientId: string) {
    startTransition(() => router.push(`/clients/${clientId}`));
  }

  async function onNewClient() {
    const name = window.prompt('Name of the new fund');
    if (!name?.trim()) return;

    setError(null);
    try {
      const repo = createSupabaseRepository(createBrowserSupabase());
      const created = await repo.createClient(name.trim());
      startTransition(() => {
        router.push(`/clients/${created.id}`);
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the fund.');
    }
  }

  return (
    <>
      <header
        data-noprint="1"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '15px 30px',
          padding: '24px 40px 0',
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 6 }}>
            Capital calls
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 15, flexWrap: 'wrap' }}>
            <select
              className="client"
              value={currentClientId}
              onChange={(e) => onSelect(e.target.value)}
              disabled={pending}
              title="Client / fund"
              aria-label="Client / fund"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={onNewClient} disabled={pending}>
              + New client
            </Button>
          </div>
        </div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Button variant="secondary" disabled title="Not connected yet">
            Ask Axtara
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {error && (
        <p
          role="alert"
          style={{ color: 'var(--destructive)', fontSize: 13, padding: '12px 40px 0' }}
        >
          {error}
        </p>
      )}
    </>
  );
}

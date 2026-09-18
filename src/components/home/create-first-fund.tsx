'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import { Button } from '@/components/ui/button';

/**
 * Creating the very first fund.
 *
 * The header carries the same action, but the header only renders on a fund's
 * own pages — so before there is a fund there is nowhere to click, and the
 * empty state has to carry its own way out. Without this the first sign-in is a
 * dead end: an account with a firm, no funds, and no control that makes one.
 */
export function CreateFirstFund() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    const name = window.prompt('Name of the fund', 'Illustrative Fund I, L.P.');
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
    <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
      <div>
        <Button onClick={onCreate} disabled={pending}>
          {pending ? 'Creating…' : 'Create the first fund'}
        </Button>
      </div>
      {error ? (
        <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

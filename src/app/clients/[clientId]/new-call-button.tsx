'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import { newModelFromTemplate } from '@/engine/fixtures/illustrative-fund';
import { Button } from '@/components/ui/button';

/**
 * Starts the next capital call and opens its setup screen.
 *
 * If a not-started call already exists it is reused rather than piling up empty
 * calls — clicking twice should not leave the fund with two Call No. 4s.
 *
 * A new call is seeded from the illustrative template only as a starting shape;
 * the Source step is where the accountant replaces it with their workbook,
 * manual entry, or a register carried forward from the previous call.
 */
export function NewCallButton({
  clientId,
  reuseCallId,
}: {
  clientId: string;
  /** An existing not-started call to open instead of creating another. */
  reuseCallId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);

    if (reuseCallId) {
      router.push(`/clients/${clientId}/calls/${reuseCallId}/setup`);
      return;
    }

    setBusy(true);
    try {
      const repo = createSupabaseRepository(createBrowserSupabase());
      const created = await repo.createCall(clientId, newModelFromTemplate(), {
        setup: 'template',
        lps: 'empty',
        components: 'empty',
        fee: 'template',
        transfers: 'empty',
      });
      router.push(`/clients/${clientId}/calls/${created.id}/setup`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a new call.');
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <Button variant="primary" large onClick={onClick} disabled={busy}>
        {busy ? 'Starting…' : 'New capital call'}
      </Button>
      {error && (
        <span role="alert" style={{ color: 'var(--destructive)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}

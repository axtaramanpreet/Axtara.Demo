'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import { emptyCall, type CallDefaults } from '@/engine';
import { Button } from '@/components/ui/button';

/**
 * Starts the next capital call and opens its setup screen.
 *
 * If a not-started call already exists it is reused rather than piling up empty
 * calls — clicking twice should not leave the fund with two Call No. 4s.
 *
 * A new call starts empty apart from the fund's own name. It used to be seeded
 * from the illustrative fixture, which meant a real call arrived carrying
 * another fund's fee, organizational cap and rounding plug, with the notice
 * headed "Illustrative Fund II, L.P." — none of it chosen, all of it plausible.
 *
 * The Source step is where the figures come from: an uploaded workbook, the
 * previous call carried forward, or typing. The illustrative data is still
 * there as an explicit choice.
 */
export function NewCallButton({
  fundId,
  fundName,
  defaults,
  reuseCallId,
}: {
  fundId: string;
  /** The fund's name, which becomes the new call's Fund_Name. */
  fundName: string;
  /** The general partner and signatory a new call starts with. */
  defaults: CallDefaults;
  /** An existing not-started call to open instead of creating another. */
  reuseCallId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);

    if (reuseCallId) {
      router.push(`/funds/${fundId}/calls/${reuseCallId}/setup`);
      return;
    }

    setBusy(true);
    try {
      const repo = createSupabaseRepository(createBrowserSupabase());
      const created = await repo.createCall(fundId, emptyCall(fundName, defaults), {
        setup: 'empty',
        lps: 'empty',
        components: 'empty',
        fee: 'empty',
        transfers: 'empty',
      });
      router.push(`/funds/${fundId}/calls/${created.id}/setup`);
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

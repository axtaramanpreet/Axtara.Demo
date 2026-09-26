'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import { applyFundTerms, emptyCall, type CallDefaults, type FundTerms } from '@/engine';
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
  terms,
  reuseCallId,
  label = 'New capital call',
  variant = 'primary',
  align = 'end',
}: {
  fundId: string;
  /** The fund's name, which becomes the new call's Fund_Name. */
  fundName: string;
  /** The deployment's configured general partner and signatory. */
  defaults: CallDefaults;
  /** The fund's terms in force today, applied on top. Null if none recorded. */
  terms: FundTerms | null;
  /** An existing not-started call to open instead of creating another. */
  reuseCallId?: string;
  label?: string;
  variant?: 'primary' | 'secondary';
  align?: 'start' | 'end';
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
      const { model } = applyFundTerms(emptyCall(fundName, defaults), terms, { prefillPlug: true });
      const created = await repo.createCall(fundId, model, {
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
    <div style={{ display: 'grid', gap: 6, justifyItems: align }}>
      <Button variant={variant} large={variant === 'primary'} onClick={onClick} disabled={busy}>
        {busy ? 'Starting…' : label}
      </Button>
      {error && (
        <span role="alert" style={{ color: 'var(--destructive)', fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}

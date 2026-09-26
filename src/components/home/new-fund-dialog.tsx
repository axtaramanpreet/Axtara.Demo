'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import { Button } from '@/components/ui/button';

/**
 * Naming a new fund, and saying what comes after.
 *
 * Only the name is asked for here. Everything else about a fund — its terms,
 * who committed — has its own screen with the room to get it right, and the
 * new fund opens on a checklist that walks through them in order.
 */
export function NewFundDialog({
  existingNames = [],
  onClose,
}: {
  /** Names already in use, to warn before creating a second fund of the same name. */
  existingNames?: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Latest onClose without re-running the effect: focus is set once, on open.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    input.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const trimmed = name.trim();
  const duplicate = existingNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createSupabaseRepository(createBrowserSupabase()).createFund(trimmed);
      startTransition(() => {
        router.push(`/funds/${created.id}`);
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the fund.');
      setBusy(false);
    }
  }

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-fund-title" onSubmit={create}>
        <h2 id="new-fund-title" style={{ margin: 0, fontSize: 18 }}>
          New fund
        </h2>
        <label style={{ display: 'grid', gap: 6, marginTop: 16, fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>Fund name</span>
          <input
            ref={input}
            className="cell"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Meridian Growth Partners III, L.P."
            aria-describedby="new-fund-next"
            style={{ border: '1px solid var(--border)', height: 36 }}
          />
        </label>
        {duplicate && (
          <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--muted-foreground)' }}>
            A fund with this name already exists. You can still create another.
          </p>
        )}
        <p id="new-fund-next" className="text-muted" style={{ fontSize: 13, margin: '14px 0 0', textWrap: 'pretty' }}>
          Next, the fund opens on four steps: its terms from the LPA, its investors, its first
          close, then the first call.
        </p>
        {error && (
          <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, margin: '10px 0 0' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!trimmed} loading={busy || pending}>
            Create fund
          </Button>
        </div>
      </form>
    </div>
  );
}

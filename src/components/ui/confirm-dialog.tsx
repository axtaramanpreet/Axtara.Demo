'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

/**
 * Confirming a step that cannot be undone, with what it will fix in place
 * shown rather than left to memory.
 *
 * Used instead of the browser's own confirm box, which cannot say more than a
 * sentence and looks like a different product.
 */
export function ConfirmDialog({
  title,
  children,
  confirm,
  danger,
  busy,
  disabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What happens, in the person's terms: the figures, the date, what cannot change after. */
  children: ReactNode;
  /** The confirming button's label, saying what it does: "Finalise closing 2", not "OK". */
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  /** Holds back the confirming button, e.g. until a required choice is made. */
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onCancel);
  useEffect(() => {
    close.current = onCancel;
  });
  useEffect(() => {
    // Focus starts on Cancel: the safe choice is the one a stray Enter makes.
    box.current?.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div ref={box} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title" style={{ margin: 0, fontSize: 18 }}>
          {title}
        </h2>
        <div style={{ marginTop: 12, fontSize: 13, display: 'grid', gap: 8 }}>{children}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button data-cancel variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={busy} disabled={disabled} className={danger ? 'btn-danger' : undefined}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

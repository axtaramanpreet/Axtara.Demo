'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * A popover of secondary actions.
 *
 * The point is hierarchy rather than tidiness. On the notices screen, sending
 * is irreversible and printing is not, and they were sitting side by side at
 * the same weight. Everything that is not the next step in the workflow belongs
 * behind this, leaving one bold button that says what to do now.
 *
 * Closes on Escape, on a click outside, and after an item is chosen. Focus
 * returns to the trigger, so keyboard use does not strand you at the top of the
 * document.
 */
export function Menu({
  label = 'More actions',
  children,
  align = 'end',
}: {
  /** Accessible name for the trigger. */
  label?: string;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent | TouchEvent) {
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
    <div ref={wrapper} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: open ? 'var(--muted)' : 'transparent',
          color: 'var(--foreground)',
          cursor: 'pointer',
        }}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          // Chosen from anywhere inside, so each item does not have to remember
          // to close the thing it lives in.
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align === 'end' ? 'right' : 'left']: 0,
            zIndex: 20,
            minWidth: 208,
            padding: 5,
            display: 'grid',
            gap: 1,
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One row in a `Menu`. */
export function MenuItem({
  icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is unavailable, when it is. */
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '7px 9px',
        borderRadius: 6,
        border: 0,
        background: 'transparent',
        color: disabled ? 'var(--muted-foreground)' : 'var(--foreground)',
        font: 'inherit',
        fontSize: 13,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--muted)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ display: 'inline-flex', opacity: disabled ? 0.5 : 0.75 }}>{icon}</span>
      {children}
    </button>
  );
}

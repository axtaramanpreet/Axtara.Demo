'use client';

import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * An (i) beside a field that says what the field means.
 *
 * Opens on hover and on keyboard focus, and toggles on click so it works on a
 * touch screen too. The text is tied to the button with aria-describedby, so
 * a screen reader reads it with the button rather than leaving it floating.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <span
      className="infotip"
      ref={wrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="infotip-button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info size={13} aria-hidden />
      </button>
      {open && (
        <span role="tooltip" id={id} className="infotip-body">
          {children}
        </span>
      )}
    </span>
  );
}

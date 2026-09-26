'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Closes a menu on a click outside it or on Escape, and on Escape puts focus
 * back on the button that opened it — so a keyboard user is never stranded.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  wrapper: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapper.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      close();
      trigger.current?.focus();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, wrapper, trigger]);
}

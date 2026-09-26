'use client';

import { useEffect } from 'react';

const QUESTION = 'You have changes that are not saved. Leave without saving them?';

/**
 * Ask before leaving a page with unsaved changes.
 *
 * Nothing on a financial screen saves by itself, so leaving is the one way to
 * lose work. Two ways out are covered: closing or reloading the tab, and
 * following any link in the app — the App Router has no navigation event to
 * hook, so a link click is caught before it navigates.
 */
export function useLeaveGuard(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const to = new URL(link.href, window.location.href);
      // A download (the notice PDFs) or another site does not leave this page's work behind.
      if (to.origin !== window.location.origin || to.pathname.startsWith('/api/')) return;
      if (to.pathname === window.location.pathname) return;
      if (!window.confirm(QUESTION)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture, so this runs before Next's own link handler.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [unsaved]);
}

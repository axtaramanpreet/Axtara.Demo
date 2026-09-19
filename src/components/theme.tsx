'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from './shell/icons';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'capcall.theme';

/**
 * The theme lives on `<html>`, not in React state.
 *
 * The inline script below applies it before first paint, so by the time React
 * runs the answer is already on the page. Reading it with
 * `useSyncExternalStore` rather than mirroring it into state means there is one
 * source of truth and no effect that sets state on mount — and React knows to
 * reconcile the server's guess after hydration without a mismatch warning.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

const getSnapshot = (): Theme =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';

// The server cannot know the viewer's preference, so it renders light and the
// inline script has already corrected the DOM by the time this matters.
const getServerSnapshot = (): Theme => 'light';

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage throws in a private window with site data blocked. The theme
      // still applies for this page view; it just will not be remembered.
    }
  }, []);

  return { theme, setTheme };
}

/**
 * The sun/moon button in the top bar.
 *
 * One button that flips, rather than the two-segment pill: in a 54px bar next
 * to a breadcrumb there is no room to show both states, and the icon shown is
 * the one you would be switching to.
 */
export function ThemeIconButton() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="icon-btn"
      title={next === 'dark' ? 'Dark mode' : 'Light mode'}
      aria-label={next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

const RAIL_KEY = 'capcall.rail';

/**
 * Whether the sidebar is collapsed to a rail.
 *
 * Kept on `<html>` for the same reason as the theme: the pre-paint script has
 * already decided by the time React runs, so there is no mismatch to reconcile
 * and no frame at the wrong width. Reading it through the same store means the
 * sidebar and the top bar's toggle cannot disagree about it.
 */
export function useRail() {
  const rail = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('rail'),
    () => false,
  );

  const setRail = useCallback((next: boolean) => {
    document.documentElement.classList.toggle('rail', next);
    try {
      window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
    } catch {
      // Private window with site data blocked: it applies now, it just will
      // not be remembered.
    }
  }, []);

  return { rail, setRail };
}

/**
 * Applies the stored theme and sidebar width before the page paints.
 *
 * Without this a dark-mode viewer sees a white flash on every navigation, and
 * somebody who collapsed the sidebar sees it open and then jump. It has to be
 * a blocking inline script, hence a string rather than a component.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var c = document.documentElement.classList;
    if (localStorage.getItem('${STORAGE_KEY}') === 'dark') c.add('dark');
    if (localStorage.getItem('${RAIL_KEY}') === '1') c.add('rail');
  } catch (e) {}
})();
`;

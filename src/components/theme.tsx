'use client';

import { useCallback, useSyncExternalStore } from 'react';

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

/** The Light/Dark pill in the header. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="toggle" title="Theme">
      <button
        type="button"
        className={theme === 'light' ? 'on' : undefined}
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
      >
        Light
      </button>
      <button
        type="button"
        className={theme === 'dark' ? 'on' : undefined}
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
      >
        Dark
      </button>
    </div>
  );
}

/**
 * Applies the stored theme before the page paints.
 *
 * Without this a dark-mode viewer sees a white flash on every navigation. It
 * has to be a blocking inline script, hence a string rather than a component.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem('${STORAGE_KEY}') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

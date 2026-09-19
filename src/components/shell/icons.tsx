/**
 * The sidebar and top bar line icons.
 *
 * Written out rather than pulled from `lucide-react` like the rest of the app:
 * these are the handoff's own drawings, at its own 1.6 stroke, and the sidebar
 * is the one place the design is exact about them. Stroke and size come from
 * `.nav-item svg` / `.icon-btn svg`, so each path only has to be a path.
 */

export function CallsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h7" />
      <circle cx="18" cy="16" r="3" />
      <path d="M18 14.5v1.5l1 1" />
    </svg>
  );
}

export function InvestorsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14a5 5 0 0 1 5.5 5" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** The sidebar toggle: a panel with an arrow pointing the way it will move. */
export function PanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
      <path d="M15.5 10l-2 2 2 2" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SendArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

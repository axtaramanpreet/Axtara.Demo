import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Renders the taller 38px call-to-action used for the primary action on a page. */
  large?: boolean;
  /**
   * Shows a spinner in place of the leading icon, and disables the button.
   *
   * The label stays, so the button keeps its width and the row does not jump
   * while something is in flight.
   */
  loading?: boolean;
}

/**
 * The one button in the system. 34px tall, 13px/500.
 *
 * `secondary` carries a border and shadow so it reads as raised against the
 * page; `ghost` is flat until hovered. Disabled uses opacity rather than a
 * colour change, so a disabled primary still looks like the primary action.
 */
export function Button({
  variant = 'secondary',
  large,
  loading,
  disabled,
  className,
  style,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      style={large ? { height: 38, padding: '0 18px', ...style } : style}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

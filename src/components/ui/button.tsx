import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface Common extends ButtonHTMLAttributes<HTMLButtonElement> {
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
 * A square, label-free button *must* carry an `aria-label`, and the types say
 * so: an icon with no accessible name is a button that does not exist to a
 * screen reader, and that is not something to catch in review.
 */
type ButtonProps =
  | (Common & { iconOnly?: false })
  | (Common & { iconOnly: true; 'aria-label': string });

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
  iconOnly,
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
      className={['btn', `btn-${variant}`, iconOnly && 'btn-icon', className]
        .filter(Boolean)
        .join(' ')}
      style={large ? { height: 38, padding: '0 18px', ...style } : style}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

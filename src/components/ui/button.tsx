import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface Common extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** The taller 38px call-to-action used for the primary action on a page. */
  large?: boolean;
  /** The shorter 28px control used inside a dense list, where 34px crowds a row. */
  small?: boolean;
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
 *
 * All three sizes are classes rather than inline styles, so a caller cannot
 * end up with a height the stylesheet does not know about.
 */
export function Button({
  variant = 'secondary',
  large,
  small,
  loading,
  iconOnly,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'btn',
        `btn-${variant}`,
        large && 'btn-lg',
        small && 'btn-sm',
        iconOnly && 'btn-icon',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

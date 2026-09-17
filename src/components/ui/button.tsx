import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Renders the taller 38px call-to-action used for the primary action on a page. */
  large?: boolean;
}

/**
 * The one button in the system. 34px tall, 13px/500.
 *
 * `secondary` carries a border and shadow so it reads as raised against the
 * page; `ghost` is flat until hovered. Disabled uses opacity rather than a
 * colour change, so a disabled primary still looks like the primary action.
 */
export function Button({ variant = 'secondary', large, className, style, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      style={large ? { height: 38, padding: '0 18px', ...style } : style}
    />
  );
}

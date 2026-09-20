/**
 * The Axtara wordmark.
 *
 * One SVG, tinted by CSS to whatever colour the surrounding text is, so it is
 * correct in both themes without a second file to keep in step. The aspect
 * ratio is the artwork's own — 4892 × 1120 — and only the height is set, so it
 * cannot be stretched by accident.
 */

const RATIO = 4892 / 1120;

export function Wordmark({ height = 15 }: { height?: number }) {
  return (
    <span
      className="brand-word"
      role="img"
      aria-label="Axtara"
      style={{ height, width: Math.round(height * RATIO) }}
    />
  );
}

/** The mark without the letters: a square turned 45°, as the site draws it. */
export function BrandMark() {
  return <span className="brand-mark" role="img" aria-label="Axtara" />;
}

/**
 * The two-to-four character tile that stands for a fund in the sidebar.
 *
 * Funds in one client are often the same name with a different numeral —
 * "Illustrative Fund II" beside "Illustrative Fund III" — so the numeral is the
 * part that has to survive. A name without one falls back to the initials of
 * its first two distinguishing words.
 *
 * Deliberately not stored: it is derived from the name every time, so renaming
 * a fund cannot leave a stale code behind.
 */

/** Legal suffixes, which say nothing about which fund this is. */
const SUFFIX = /,?\s*(L\.?P\.?|LLC|Ltd\.?|Limited|Inc\.?)\s*$/i;

/** I, II, III, IV … XXXIX. */
const ROMAN = /^(X{0,3})(IX|IV|V?I{0,3})$/i;

/** Words almost every fund in a client shares, so they cannot distinguish one. */
const GENERIC_WITH_NUMERAL =
  /^(the|illustrative|fund|capital|partners|opportunities|growth|ventures)$/i;
const GENERIC = /^(the|illustrative|fund|capital|partners)$/i;

export function fundCode(name: string): string {
  const clean = String(name || '')
    .replace(SUFFIX, '')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);

  // `.pop()` rather than `.find()`: "Fund II Series III" is numbered by the
  // last numeral, not the first.
  const roman = words.filter((w) => ROMAN.test(w) && w.length <= 4).pop();
  const arabic = words.filter((w) => /^\d{1,3}$/.test(w)).pop();
  const numeral = roman || arabic;

  if (numeral) {
    const stem = words.find(
      (w) => !GENERIC_WITH_NUMERAL.test(w) && w !== roman && w !== arabic,
    );
    return ((stem ? stem[0] : '') + numeral).toUpperCase().slice(0, 4);
  }

  const distinguishing = words.filter((w) => !GENERIC.test(w));
  const pair =
    distinguishing.length >= 2
      ? distinguishing[0][0] + distinguishing[1][0]
      : (distinguishing[0] || words[0] || '?').slice(0, 2);

  return pair.toUpperCase();
}

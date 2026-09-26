/** Reading a generated PDF back as text, for tests. */

import { inflateSync } from 'node:zlib';

/**
 * The text of a PDF.
 *
 * Two things had to be got right, and getting either wrong returns an empty
 * string that would quietly pass a weaker assertion:
 *
 *  - Content streams are Flate-compressed, so the raw bytes carry no readable
 *    operators at all. Each stream is inflated first.
 *  - @react-pdf writes text as hex strings inside a TJ array — `[<496c6c…>]`,
 *    not `(Illustrative)` — so a search for literal strings finds nothing.
 *
 * Runs are joined with no separator, because a line is broken wherever styling
 * or kerning changes and "1,393,719.91" arrives in several pieces.
 */
/**
 * The WinAnsi bytes that are not Latin-1.
 *
 * 0x80-0x9f is a control range in Latin-1 but holds punctuation in WinAnsi,
 * which is what these fonts use. Without this an em dash decodes to U+0097 and
 * "Investment — Deal X" never matches the label it came from.
 */
const WIN_ANSI: Record<number, string> = {
  0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030',
  0x8a: '\u0160', 0x8b: '\u2039', 0x8c: '\u0152', 0x8e: '\u017d',
  0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201c', 0x94: '\u201d',
  0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x98: '\u02dc',
  0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153',
  0x9e: '\u017e', 0x9f: '\u0178',
};

function decodeWinAnsi(bytes: Buffer): string {
  let out = '';
  for (const byte of bytes) {
    out += WIN_ANSI[byte] ?? String.fromCharCode(byte);
  }
  return out;
}

export function textOf(pdf: Buffer): string {
  const out: string[] = [];

  const open = Buffer.from('stream');
  const close = Buffer.from('endstream');

  let at = 0;
  for (;;) {
    const start = pdf.indexOf(open, at);
    if (start < 0) break;
    const stop = pdf.indexOf(close, start);
    if (stop < 0) break;

    // Skip `stream` and the end-of-line that must follow it.
    let from = start + open.length;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;

    const body = pdf.subarray(from, stop);
    at = stop + close.length;

    let content: string;
    try {
      content = inflateSync(body).toString('latin1');
    } catch {
      // Not a compressed stream — an embedded font programme, say.
      continue;
    }

    // Every text-showing operator: `[…] TJ`, `(…) Tj` and `<…> Tj`.
    for (const op of content.matchAll(/(\[[^\]]*\]|\([^)]*\)|<[0-9A-Fa-f\s]*>)\s*T[Jj]/g)) {
      const operand = op[1];

      for (const hex of operand.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
        const digits = hex[1].replace(/\s+/g, '');
        out.push(decodeWinAnsi(Buffer.from(digits, 'hex')));
      }

      for (const literal of operand.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
        out.push(literal[1].replace(/\\([()\\])/g, '$1'));
      }
    }
  }

  return out.join('');
}

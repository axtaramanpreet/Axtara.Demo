/**
 * The PDF carries the same figures as the notice on screen.
 *
 * The PDF layout is written separately from `notice-sheet.tsx`, so the two can
 * drift apart in appearance — and appearance is not what matters. What matters
 * is that no amount goes missing on the way into the file an investor is asked
 * to wire against. These tests read the generated PDF back and look for every
 * figure the engine produced.
 */

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildNotice, compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import { noticeFileName, renderNoticePdf } from '../notice-pdf';

const result = compute(ILLUSTRATIVE_FUND);
const row = result.rows.find((r) => r.LP_ID === 'LP01')!;
const notice = buildNotice(ILLUSTRATIVE_FUND, result, row);

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

function textOf(pdf: Buffer): string {
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

/**
 * The first part of `parts` not found at or after the previous one, or null.
 *
 * A plain `contains` check is not enough here: the total appears both in the
 * band at the top and on the last line of section A, so deleting the line still
 * left the figure in the document and the test still passed. Requiring the
 * labels and amounts in order means a missing row is a missing row.
 */
function firstOutOfOrder(text: string, parts: string[]): string | null {
  let at = 0;
  for (const part of parts) {
    const found = text.indexOf(part, at);
    if (found < 0) return part;
    at = found + part.length;
  }
  return null;
}

describe('a notice as a PDF', () => {
  it('is a PDF', async () => {
    const pdf = await renderNoticePdf(notice, 'draft');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('carries every line, labelled, in the order the notice sets out', async () => {
    const text = textOf(await renderNoticePdf(notice, 'draft'));
    const plain = (amount: string) => amount.replace(/[()]/g, '');

    const sequence = [
      'TOTAL AMOUNT DUE',
      plain(notice.total),
      'A. Purpose of this Capital Call',
      ...notice.inside.flatMap((l) => [l.label, plain(l.amt)]),
      'Subtotal',
      plain(notice.subtotalInside),
      ...notice.outside.flatMap((l) => [l.label, plain(l.amt)]),
      'Total Amount Called',
      plain(notice.total),
      'B. Your Capital Account Summary',
      ...notice.account.flatMap((l) => [l.label, plain(l.amt)]),
    ];

    expect(firstOutOfOrder(text, sequence)).toBeNull();
  });

  it('carries the letter the engine composed, not a copy of its own', async () => {
    // The wording lives in buildNotice so the page and the PDF cannot disagree.
    // If this file ever grows its own paragraph, this fails.
    const text = textOf(await renderNoticePdf(notice, 'draft'));

    expect(firstOutOfOrder(text, [
      `Capital Call #${notice.callNo}`,
      notice.salutation,
      ...notice.intro,
      ...notice.closing,
    ])).toBeNull();
  });

  it('names the investor, the fund and both dates', async () => {
    const text = textOf(await renderNoticePdf(notice, 'draft'));
    for (const value of [notice.name, notice.fund, notice.id, notice.callDate, notice.dueDate]) {
      expect(text, `missing ${value}`).toContain(value);
    }
  });

  it('marks a draft as a draft, and a sent notice as issued', async () => {
    expect(textOf(await renderNoticePdf(notice, 'draft'))).toContain('DRAFT');
    expect(textOf(await renderNoticePdf(notice, 'approved'))).toContain('DRAFT');

    const sent = textOf(await renderNoticePdf(notice, 'sent', '2026-10-01T09:00:00Z'));
    expect(sent).toContain('ISSUED');
    expect(sent).not.toContain('DRAFT');
  });

  it('renders every investor on every scenario without throwing', async () => {
    // Zero fees, negative offsets, excused investors and transferred-out rows
    // all reach this layout eventually.
    for (const model of Object.values(SCENARIOS)) {
      const computed = compute(structuredClone(model));
      for (const r of computed.rows.filter((x) => x.isActive)) {
        const pdf = await renderNoticePdf(buildNotice(model, computed, r), 'draft');
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      }
    }
  }, 120_000);
});

describe('what the file is called', () => {
  it('follows Capital Call #N_Investor.pdf', () => {
    expect(noticeFileName(1, 'Alpha Pension Trust')).toBe(
      'Capital Call #1_Alpha Pension Trust.pdf',
    );
    expect(noticeFileName(2, 'Beta University Endowment')).toBe(
      'Capital Call #2_Beta University Endowment.pdf',
    );
  });

  it('keeps the punctuation a fund name legitimately carries', () => {
    expect(noticeFileName(3, 'Illustrative Fund II, L.P.')).toBe(
      'Capital Call #3_Illustrative Fund II, L.P..pdf',
    );
  });

  it('strips characters that would make it a path rather than a name', () => {
    // A zip entry containing a separator is a directory traversal, not a file.
    expect(noticeFileName(1, 'Acme / Beta: "Gamma"')).toBe(
      'Capital Call #1_Acme Beta Gamma.pdf',
    );
    expect(noticeFileName(1, 'a/b')).not.toContain('/');
    expect(noticeFileName(1, 'a\\b')).not.toContain('\\');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(noticeFileName(1, '   ')).toBe('Capital Call #1_Investor.pdf');
  });
});

/**
 * The PDF carries the same figures as the notice on screen.
 *
 * The PDF layout is written separately from `notice-sheet.tsx`, so the two can
 * drift apart in appearance — and appearance is not what matters. What matters
 * is that no amount goes missing on the way into the file an investor is asked
 * to wire against. These tests read the generated PDF back and look for every
 * figure the engine produced.
 */

import { describe, expect, it } from 'vitest';
import { BLANK_TERMS, buildNotice, compute, paymentInstructions } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import { noticeFileName, renderNoticePdf } from '../notice-pdf';
import { textOf } from './pdf-text';

const result = compute(ILLUSTRATIVE_FUND);
const row = result.rows.find((r) => r.LP_ID === 'LP01')!;
const notice = buildNotice(ILLUSTRATIVE_FUND, result, row);

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

  it('prints every footnote mark as its number, past three as well', async () => {
    // The marks are superscript characters (¹ ² ³ ⁴…). The PDF's built-in
    // Helvetica only has ¹ ² ³; from ⁴ on it kept the low byte of the code
    // point, so ⁴ (U+2074) printed as "t", ⁵ as "u", and so on. The label
    // check above still passed, because the label was all there — the stray
    // letter sat after it. LP01's notice has four footnote marks, so its
    // outside-commitment line is the one that showed it.
    const text = textOf(await renderNoticePdf(notice, 'draft'));
    const number = (mark: string) => String('¹²³⁴⁵⁶⁷⁸⁹'.indexOf(mark) + 1);

    const lines = [...notice.inside, ...notice.outside];
    expect(lines.some((l) => l.mark === '⁴')).toBe(true);

    for (const line of lines) {
      expect(text, `${line.label} should carry note ${number(line.mark)}`).toContain(
        `${line.label} ${number(line.mark)}`,
      );
    }
    expect(text).not.toContain('(outside commitment) t');
  });

  it('prints where to wire the money, with this investor\u2019s reference, once the fund has set it', async () => {
    const payment = paymentInstructions(
      {
        ...BLANK_TERMS,
        paymentBankName: 'JPMorgan Chase Bank, N.A.',
        paymentAccountName: 'Illustrative Fund II, L.P.',
        paymentAccountNo: '000123456789',
        paymentSwift: 'CHASUS33',
        paymentReference: '{LP_ID} Call {CALL_NO}',
      },
      { lpId: 'LP01', callNo: 2 },
    );
    const withIt = buildNotice(ILLUSTRATIVE_FUND, result, row, { payment });
    const text = textOf(await renderNoticePdf(withIt, 'draft'));
    expect(firstOutOfOrder(text, ['Payment instructions', 'Bank', 'JPMorgan Chase Bank, N.A.', 'Account number', '000123456789', 'Reference', 'LP01 Call 2'])).toBeNull();
    // The letter points at the instructions only when they are there.
    expect(withIt.closing[0]).toContain('using the payment instructions above');
    expect(notice.closing[0]).not.toContain('payment instructions');
    expect(textOf(await renderNoticePdf(notice, 'draft'))).not.toContain('Payment instructions');
  });

  it('prints nothing for a fund with a bank but no account number', () => {
    expect(paymentInstructions({ ...BLANK_TERMS, paymentBankName: 'Some Bank' }, { lpId: 'LP01' })).toBeNull();
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

describe('a notice billing the fee for several periods', () => {
  it('names the periods, and this investor’s fee for each, rather than one rate', async () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.fee.offsets = [];
    model.feeSchedule = [
      { from: '2026-04-01', to: '2026-06-30', label: 'Q2 2026', byLp: { LP01: 50_000 } },
      { from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP01: 45_000 } },
    ];
    const computed = compute(model);
    const lp01 = computed.rows.find((r) => r.LP_ID === 'LP01')!;
    const text = textOf(await renderNoticePdf(buildNotice(model, computed, lp01), 'draft'));
    expect(text).toContain('Management Fee — Q2–Q3 2026');
    expect(text).toContain('95,000.00');
    expect(text).toContain('Q2 2026 (1 April 2026 – 30 June 2026) USD 50,000.00; Q3 2026 (1 July 2026 – 30 September 2026) USD 45,000.00');
    expect(text).not.toMatch(/p\.a\., current period/);
  });
});

describe('a notice that settles a later closing’s equalization, as a PDF', () => {
  it('shows what the call draws, the equalization, then the amount due, in that order', async () => {
    const model = {
      ...structuredClone(ILLUSTRATIVE_FUND),
      equalizationSchedule: [
        { closingId: 'c2', closingNo: 2, closingDate: '2026-08-01', byLp: { LP01: 1_000 }, parts: { LP01: { capital: 0, interest: 0, catchUpFee: 1_000 } } },
      ],
    };
    const r = compute(model);
    const n = buildNotice(model, r, r.rows.find((x) => x.LP_ID === 'LP01')!);
    const text = textOf(await renderNoticePdf(n, 'draft'));
    expect(
      firstOutOfOrder(text, ['Total Amount Called', n.called!, 'Equalization — Closing 2 (1 August 2026)', 'Catch-up management fee', '1,000.00', 'Equalization total', '1,000.00', 'Total Amount Due', n.total]),
    ).toBeNull();
  });
});

describe('a notice whose equalization credit is larger than the call, as a PDF and an email', () => {
  it('says the amount is payable to them, and asks for nothing', async () => {
    const plainRow = compute(ILLUSTRATIVE_FUND).rows.find((x) => x.LP_ID === 'LP01')!;
    const model = {
      ...structuredClone(ILLUSTRATIVE_FUND),
      equalizationSchedule: [
        {
          closingId: 'c2', closingNo: 2, closingDate: '2026-08-01',
          byLp: { LP01: -(plainRow.total + 500) },
          parts: { LP01: { capital: -(plainRow.total + 500), interest: 0, catchUpFee: 0 } },
        },
      ],
    };
    const r = compute(model);
    const n = buildNotice(model, r, r.rows.find((x) => x.LP_ID === 'LP01')!, { payment: [{ label: 'Bank', value: 'First Harbour' }] });
    const text = textOf(await renderNoticePdf(n, 'draft'));
    expect(firstOutOfOrder(text, ['AMOUNT PAYABLE TO YOU', '500.00', 'Total Amount Called', 'Amount Payable to You', '500.00'])).toBeNull();
    expect(text).not.toContain('First Harbour');
    const { noticeEmail } = await import('../notice-email');
    const mail = noticeEmail(n, Buffer.from(''), 'a@example.com');
    expect(mail.text).toContain(`Payable to you ${n.cur} 500.00`);
    expect(mail.text).not.toContain('Amount due');
  });
});

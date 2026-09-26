/**
 * The equalization statement carries every figure of the investor's working.
 *
 * Same idea as the notice test: read the PDF back and look for each amount the
 * engine produced, in order, so a dropped row is caught and not hidden by the
 * total printed elsewhere.
 */

import { describe, expect, it } from 'vitest';
import { BLANK_TERMS, equalize, fmt, paymentInstructions, type FundTerms } from '@/engine';
import { renderStatementPdf, statementFileName } from '../statement-pdf';
import { textOf } from './pdf-text';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  lateCloseInterestRate: 0.08,
  lateCloseInterestBasis: 'simple',
  equalizationInterestTo: 'existing_lps',
  catchUpFeeTo: 'gp',
  paymentBankName: 'First Meridian Bank',
  paymentAccountNo: '000123456',
  paymentReference: '{LP_ID} {CALL_NO}',
};

const result = equalize({
  closingDate: '2026-08-01',
  feeStart: '2026-01-01',
  existing: [
    { lpId: 'LP01', name: 'Alpha Pension Trust', commitment: 6_000_000 },
    { lpId: 'LP02', name: 'Beta Endowment', commitment: 4_000_000 },
  ],
  newcomers: [{ lpId: 'LP07', name: 'Eta Capital', commitment: 5_000_000 }],
  priorCalls: [
    { callNo: 1, dueDate: '2026-02-15', lines: [{ lpId: 'LP01', capital: 600_000, inside: 600_000 }, { lpId: 'LP02', capital: 400_000, inside: 400_000 }] },
    { callNo: 2, dueDate: '2026-05-15', lines: [{ lpId: 'LP01', capital: 1_200_000, inside: 1_080_000 }, { lpId: 'LP02', capital: 800_000, inside: 720_000 }] },
  ],
  terms: [terms],
});

const late = result.lines.find((l) => l.lpId === 'LP07')!;
const earlier = result.lines.find((l) => l.lpId === 'LP01')!;

function inOrder(text: string, parts: string[]): string | null {
  let at = 0;
  for (const p of parts) {
    const i = text.indexOf(p, at);
    if (i < 0) return p;
    at = i + p.length;
  }
  return null;
}

const render = (line = late, finalised = false, settlement: 'on_closing' | 'next_call' | null = 'on_closing') =>
  renderStatementPdf({
    fund: 'Meridian Growth Partners III',
    closingNo: 2,
    line,
    result,
    finalised,
    payment: paymentInstructions(terms, { lpId: line.lpId, callNo: 'EQ2' }),
    settlement,
  }).then(textOf);

describe('a late investor’s statement', () => {
  it('shows each call, the interest on it, each fee period and the total, in order', async () => {
    const text = await render();
    const parts = [
      'TOTAL DUE FROM YOU',
      fmt(late.net),
      ...late.calls.map((c) => fmt(c.capital)),
      fmt(late.capital),
      ...late.calls.filter((c) => c.interest).map((c) => fmt(c.interest)),
      fmt(late.interest),
      ...late.feeSlices.filter((f) => f.amount).map((f) => fmt(f.amount)),
      fmt(late.catchUpFee),
      fmt(late.net),
    ];
    expect(late.interest).toBeGreaterThan(0);
    expect(late.catchUpFee).toBeGreaterThan(0);
    expect(inOrder(text, parts)).toBeNull();
  });

  it('shows the interest working, so it can be checked by hand', async () => {
    const text = await render();
    const c = late.calls[0];
    expect(text).toContain(`${fmt(c.capital)} × 8.00% × ${c.days}/365`);
  });

  it('says where to wire, with this investor’s reference', async () => {
    const text = await render();
    expect(text).toContain('Payment instructions');
    expect(text).toContain('000123456');
    expect(text).toContain('LP07 EQ2');
  });

  it('is stamped DRAFT until the closing is finalised, FINAL after', async () => {
    expect(await render()).toContain('DRAFT');
    const final = await render(late, true);
    expect(final).toContain('FINAL');
    expect(final).not.toContain('DRAFT');
  });
});

describe('an earlier investor’s statement', () => {
  it('shows what comes back to them, and no payment instructions', async () => {
    const text = await render(earlier);
    expect(earlier.net).toBeLessThan(0);
    expect(inOrder(text, ['TOTAL DUE TO YOU', fmt(-earlier.net), ...earlier.calls.map((c) => `(${fmt(-c.capital)})`)])).toBeNull();
    expect(text).not.toContain('Payment instructions');
  });
});

describe('a statement for a closing settled on the next call', () => {
  it('asks for no money: no payment instructions, and it says the next call collects it', async () => {
    const text = await render(late, true, 'next_call');
    expect(text).not.toContain('Payment instructions');
    expect(text).toContain('the amount is added to your next capital call');
  });

  it('tells an earlier investor it comes off their next call', async () => {
    expect(await render(earlier, true, 'next_call')).toContain('the amount comes off your next capital call');
  });
});

it('names the file after the closing and the investor', () => {
  expect(statementFileName(2, 'Eta Capital / Fund I')).toBe('Closing 2_Eta Capital Fund I.pdf');
});

describe('an existing investor who increased their commitment', () => {
  const both = equalize({
    closingDate: '2026-08-01',
    feeStart: '2026-01-01',
    existing: [
      { lpId: 'LP01', name: 'Alpha Pension Trust', commitment: 6_000_000 },
      { lpId: 'LP02', name: 'Beta Endowment', commitment: 4_000_000 },
    ],
    newcomers: [{ lpId: 'LP02', name: 'Beta Endowment', commitment: 2_000_000 }],
    priorCalls: [{ callNo: 1, dueDate: '2026-02-15', lines: [{ lpId: 'LP01', capital: 600_000, inside: 600_000 }, { lpId: 'LP02', capital: 400_000, inside: 400_000 }] }],
    terms: [terms],
  });
  const line = both.lines.find((l) => l.lpId === 'LP02')!;

  it('says their commitment increased, not that they were admitted', async () => {
    expect(line.role).toBe('both');
    const text = await render(line);
    expect(text).toContain('Your commitment increased');
    expect(text).not.toContain('You were admitted');
  });

  it('shows the working only on what they pay, and names what they receive', async () => {
    const text = await render(line);
    const paid = line.calls.find((c) => c.capital > 0)!;
    expect(text).toContain(`${fmt(paid.capital)} × 8.00% × ${paid.days}/365`);
    expect(text).toContain('your share of the interest late investors pay');
    expect(text).not.toMatch(/\([\d,.]+\) × 8\.00%/);
  });
});

describe('the statement’s email', () => {
  it('says what is due, from or to them, and attaches the PDF', async () => {
    const { statementEmail } = await import('../statement-email');
    const s = { fund: 'Meridian Growth Partners III', closingNo: 2, line: late, result, finalised: true, payment: null, settlement: 'on_closing' as const };
    const mail = statementEmail(s, Buffer.from('%PDF-'), 'eta@example.com', ['cfo@example.com']);
    expect(mail.subject).toBe('Equalization statement – Closing 2 – Meridian Growth Partners III');
    expect(mail.cc).toEqual(['cfo@example.com']);
    expect(mail.text).toContain(`Due from you   ${fmt(late.net)}`);
    expect(mail.attachments?.[0].filename).toBe(statementFileName(2, late.name));
    expect(statementEmail({ ...s, line: earlier }, Buffer.from(''), 'a@example.com').text).toContain(`Due to you     ${fmt(-earlier.net)}`);
  });
});

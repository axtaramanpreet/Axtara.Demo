/**
 * The email an equalization statement goes out in.
 *
 * Plain text with the PDF attached, as for call notices: the PDF is the
 * document, and a short, plain message that says what to check reads less like
 * the phishing a request for money is compared to.
 */

import { fmt, fmtDate } from '@/engine';
import type { Email } from './email';
import { statementFileName, type StatementInput } from './statement-pdf';

export function statementEmail(s: StatementInput, pdf: Buffer, to: string, cc: string[] = []): Email {
  const { line, result } = s;
  const owes = line.net >= 0;
  const text = [
    `Dear ${line.name},`,
    '',
    owes
      ? `${s.fund} held a closing on ${fmtDate(result.closingDate)}. The attached statement sets out the equalization you pay, so that you stand as if you had been an investor from the first close.`
      : `${s.fund} held a closing on ${fmtDate(result.closingDate)}. Investors admitted at it paid their share of what you had already contributed; the attached statement sets out what comes back to you.`,
    '',
    `    ${owes ? 'Due from you' : 'Due to you  '}   ${fmt(Math.abs(line.net))}`,
    `    Closing        No. ${s.closingNo}, ${fmtDate(result.closingDate)}`,
    `    Investor ID    ${line.lpId}`,
    '',
    owes
      ? 'The statement shows how the amount was worked out, and where to pay it.'
      : 'The statement shows how the amount was worked out.',
    '',
    'If you have any questions, please do not hesitate to contact us.',
  ].join('\n');

  return {
    to,
    cc,
    subject: `Equalization statement – Closing ${s.closingNo} – ${s.fund}`,
    text,
    attachments: [{ filename: statementFileName(s.closingNo, line.name), content: pdf }],
  };
}

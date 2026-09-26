/**
 * The email a notice goes out in.
 *
 * Deliberately plain text with the PDF attached, rather than an HTML rendering
 * of the notice. Two reasons, both about the investor rather than about us:
 *
 *  - The PDF is the document. An HTML copy beside it is a second version of the
 *    same figures that can disagree with it, and nobody should have to work out
 *    which one their wire should match.
 *  - A capital call asks somebody to move money. Mail that is plain, short and
 *    says what to check reads less like the phishing it will be compared to.
 *
 * The body carries no bank details, because the notice carries none either.
 * That gap is real and is the thing to settle before any of this reaches a
 * limited partner.
 */

import type { NoticeData } from '@/engine';
import { noticeFileName } from './notice-pdf';
import type { Email } from './email';

export function noticeEmail(
  notice: NoticeData,
  pdf: Buffer,
  to: string,
  cc: string[] = [],
): Email {
  const fileName = noticeFileName(notice.callNo, notice.name);

  const text = [
    notice.salutation,
    '',
    ...notice.intro.flatMap((p) => [p, '']),
    ...(notice.payableToYou
      ? [`    Payable to you ${notice.cur} ${notice.total}`]
      : [`    Amount due     ${notice.cur} ${notice.total}`, `    Payable by     ${notice.dueDate}`]),
    `    Notice date    ${notice.callDate}`,
    `    Investor ID    ${notice.id}`,
    '',
    'The attached notice sets out how the amount was arrived at, together with',
    'your capital account summary as at the notice date.',
    '',
    ...notice.closing.flatMap((p) => [p, '']),
    ...notice.signOff,
  ].join('\n');

  return {
    to,
    cc,
    // The same subject the notice itself carries, so the mail and the document
    // an investor files against it agree.
    subject: notice.subject,
    text,
    attachments: [{ filename: fileName, content: pdf }],
  };
}

/**
 * Builds the data for one investor's Capital Call Notice.
 *
 * This produces content only — no markup. The notice is a document an investor
 * acts on, so every figure traces back to a computed row, and the numbered
 * footnotes are generated from what actually happened in the calculation rather
 * than written by hand.
 */

import { fmt, fmtDate, num, pct, serialToISO } from './format';
import type { CallModel, ComputeResult, ComputedRow } from './types';

/** One line in the "Purpose of this Capital Call" table. */
export interface NoticeLine {
  label: string;
  /** Superscript marker tying the line to a footnote. */
  mark: string;
  amt: string;
  /** True for the fee offset, which prints in parentheses. */
  neg: boolean;
}

/** One line in the "Your Capital Account Summary" table. */
export interface NoticeAccountLine {
  label: string;
  amt: string;
  /** True for the ruled, bold subtotal lines. */
  strong?: boolean;
}

export interface NoticeFootnote {
  n: number;
  text: string;
}

export interface NoticeData {
  id: string;
  name: string;
  cur: string;
  fund: string;
  /** The general partner as the letter names it. "the General Partner" when unset. */
  gp: string;
  /** "Dear Alpha Pension Trust," */
  salutation: string;
  /** Paragraphs before the figures. */
  intro: string[];
  /** Paragraphs after the figures, including how and by when to pay. */
  closing: string[];
  /** "Capital Call #4 – Meridian Growth Partners III, L.P." */
  subject: string;
  /** The sign-off, already stripped of lines the fund left blank. */
  signOff: string[];
  callNo: string | number;
  callDate: string;
  dueDate: string;
  total: string;
  /** Lines called against capital commitment. */
  inside: NoticeLine[];
  /** Lines called outside capital commitment. */
  outside: NoticeLine[];
  hasOutside: boolean;
  subtotalInside: string;
  account: NoticeAccountLine[];
  notes: NoticeFootnote[];
}

/** Superscript markers for footnotes, falling back to `(10)` past nine. */
const SUPERSCRIPTS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/** How each allocation basis is described in a footnote. */
const BASIS_TEXT: Record<string, string> = {
  Commitment: 'pro-rata to committed capital',
  UCC: 'pro-rata to unfunded capital commitment as at the notice date',
  Invested_Capital: 'pro-rata to invested capital',
};

/**
 * Build the notice for one investor.
 *
 * @param model  The call model (for fund name, dates, currency).
 * @param result The computed result (for fund-level fee context).
 * @param row    The investor's computed row.
 */
export function buildNotice(
  model: CallModel,
  result: ComputeResult,
  row: ComputedRow,
): NoticeData {
  const { setup } = model;
  const cur = setup.Reporting_Currency || 'USD';

  // Footnotes are collected on demand and de-duplicated by key, so two
  // components sharing an allocation basis share one footnote.
  const notes: string[] = [];
  const noteIdx: Record<string, number> = {};
  const noteFor = (key: string, text: string): number => {
    if (!(key in noteIdx)) {
      notes.push(text);
      noteIdx[key] = notes.length;
    }
    return noteIdx[key];
  };
  const sup = (n: number) => SUPERSCRIPTS[n - 1] || `(${n})`;

  const joinNames = (a: string[]) =>
    a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];

  // Group component names by basis so one footnote can name them all.
  const groups: Record<string, string[]> = {};
  row.comps
    .filter((c) => !c.excused)
    .forEach((c) => {
      (groups[c.basis] = groups[c.basis] || []).push(c.name);
    });

  const inside: NoticeLine[] = [];
  const outside: NoticeLine[] = [];

  row.comps.forEach((c) => {
    // An excused LP sees no line at all for that component.
    if (c.excused) return;
    const n = noteFor(
      'basis:' + c.basis,
      `${joinNames(groups[c.basis])} ${groups[c.basis].length > 1 ? 'are' : 'is'} allocated ${
        BASIS_TEXT[c.basis] || BASIS_TEXT.Commitment
      }.`,
    );
    const label = (c.category === 'Deal' ? 'Investment — ' : '') + c.name;
    (c.reduces ? inside : outside).push({ label, mark: sup(n), amt: fmt(c.amt), neg: false });
  });

  // The fee, and its offset shown as a negative line directly beneath.
  if (row.feeGross || row.feeOffset) {
    const fn = noteFor(
      'fee',
      `The management fee is charged at ${pct(row.feeRate)} per annum on ${
        result.fee.basis === 'Invested_Capital' ? 'invested capital' : 'committed capital'
      } for the current period${
        row.feeOffset
          ? ` and is shown net of your pro-rata share of an aggregate ${cur} ${fmt(
              result.fee.offsetTotal,
            )} management fee offset; your net management fee for this period is ${cur} ${fmt(row.feeNet)}`
          : ''
      }.`,
    );

    const feeLines: NoticeLine[] = [
      {
        label: `Management Fee (${pct(row.feeRate)} p.a., current period)`,
        mark: sup(fn),
        amt: fmt(row.feeGross),
        neg: false,
      },
    ];
    if (row.feeOffset) {
      feeLines.push({
        label: 'Less: Management Fee Offset',
        mark: sup(fn),
        amt: fmt(-row.feeOffset),
        neg: true,
      });
    }
    (result.fee.reduces ? inside : outside).push(...feeLines);
  }

  // Everything called outside commitment shares one footnote, and each label is
  // suffixed so the distinction is unmissable on the page. The footnote text is
  // built from the labels before they are suffixed.
  if (outside.length) {
    const on = noteFor(
      'outside',
      `${joinNames(outside.map((o) => o.label))} ${
        outside.length > 1 ? 'are' : 'is'
      } called outside your capital commitment; ${
        outside.length > 1 ? 'they are' : 'it is'
      } payable in addition to, and ${
        outside.length > 1 ? 'do' : 'does'
      } not reduce, your unfunded commitment.`,
    );
    outside.forEach((o) => {
      o.label += ' (outside commitment)';
      o.mark = sup(on);
    });
  }

  // An excused LP gets an explanatory footnote even though no line is shown.
  if (row.excusedFrom.length) {
    noteFor(
      'excused',
      `You are excused from ${joinNames(row.excusedFrom)} under the Partnership Agreement; no amount is called from you in respect of ${
        row.excusedFrom.length > 1 ? 'those items' : 'that item'
      } and it has been allocated among the remaining partners.`,
    );
  }

  notes.push(`Amounts are rounded to ${result.d} decimal places.`);

  const fund = setup.Fund_Name;
  const callNo = setup.Call_Number as string | number;
  const dueDate = fmtDate(serialToISO(setup.Payment_Due_Date));

  // Named when the fund has told us who they are; otherwise the role, which is
  // accurate and reads properly, rather than an empty gap in a sentence.
  const gpName = String(setup.GP_Name ?? '').trim();
  const gp = gpName || 'the General Partner';

  return {
    id: row.LP_ID,
    name: row.LP_Name,
    cur,
    fund,
    gp,
    salutation: `Dear ${row.LP_Name},`,
    intro: [
      gpName
        ? `We are writing on behalf of ${gpName}, the General Partner of ${fund} (the “Fund”), ` +
          `to issue Capital Call #${callNo} pursuant to the terms of the Limited Partnership ` +
          `Agreement (the “LPA”).`
        : `We are writing on behalf of the General Partner of ${fund} (the “Fund”), to issue ` +
          `Capital Call #${callNo} pursuant to the terms of the Limited Partnership Agreement ` +
          `(the “LPA”).`,
    ],
    subject: `Capital Call #${callNo} \u2013 ${fund}`,
    // Blank lines are dropped rather than printed empty: a notice signed by
    // nobody should end at "Best Regards," and the General Partner, not leave
    // two gaps where a name and a title were meant to go.
    signOff: [
      'Best Regards,',
      String(setup.Signatory_Name ?? '').trim(),
      String(setup.Signatory_Title ?? '').trim(),
      gpName,
    ].filter(Boolean),
    closing: [
      // The fund's template had a sentence here directing the investor to
      // "the wiring instructions provided with this notice". There are none,
      // so it was removed rather than left saying something untrue in the one
      // paragraph that asks somebody to move money. Put it back when the bank
      // details exist and can actually accompany the notice.
      `Kindly ensure that the funds are received by ${dueDate}. If you have any questions ` +
        'regarding this capital call or require any additional information, please do not ' +
        'hesitate to contact us.',
      'Thank you for your continued partnership and support.',
    ],
    callNo,
    callDate: fmtDate(serialToISO(setup.Call_Date)),
    dueDate,
    total: fmt(row.total),
    inside,
    outside,
    hasOutside: outside.length > 0,
    subtotalInside: fmt(row.reduces),
    account: [
      { label: 'Total Capital Commitment', amt: fmt(num(row.Commitment)) },
      { label: 'Contributions prior to this call', amt: fmt(row.openPaid) },
      { label: 'Contributions called — this notice (against commitment)', amt: fmt(row.reduces) },
      ...(outside.length
        ? [
            {
              label: 'Contributions called — this notice (outside commitment)',
              amt: fmt(row.outside),
            },
          ]
        : []),
      { label: 'Total Contributions to Date', amt: fmt(row.closingPaid), strong: true },
      { label: 'Unfunded Commitment — before this call', amt: fmt(row.openUCC) },
      { label: 'Less: applied against commitment this call', amt: fmt(-row.reduces) },
      { label: 'Unfunded Commitment — after this call', amt: fmt(row.closingUCC), strong: true },
    ],
    notes: notes.map((t, i) => ({ n: i + 1, text: t })),
  };
}

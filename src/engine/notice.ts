/**
 * Builds the data for one investor's Capital Call Notice.
 *
 * This produces content only — no markup. The notice is a document an investor
 * acts on, so every figure traces back to a computed row, and the numbered
 * footnotes are generated from what actually happened in the calculation rather
 * than written by hand.
 */

import { isDeal } from './categories';
import { amountDue } from './equalization-billing';
import { scheduleLabel } from './fee-billing';
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

/** One later closing's equalization on a notice: its parts, then its total. + to pay, − credited. */
export interface NoticeEqualization {
  /** "Equalization — Closing 2 (2 May 2022)" */
  label: string;
  mark: string;
  /** The parts that are not nothing, each labelled for this investor's side of it. */
  parts: { label: string; amt: string }[];
  total: string;
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
  /**
   * The amount to wire: what the call draws, plus any equalization it settles.
   * When `payableToYou`, the fund pays it to the investor instead.
   */
  total: string;
  /** An equalization credit larger than the call: the fund pays `total` to the investor. Only then. */
  payableToYou?: true;
  /** What the call itself draws, before equalization. Only when it settles some. */
  called?: string;
  /** Each later closing's equalization settled on this notice, taken apart. Only when it settles some. */
  equalization?: NoticeEqualization[];
  /** Lines called against capital commitment. */
  inside: NoticeLine[];
  /** Lines called outside capital commitment. */
  outside: NoticeLine[];
  hasOutside: boolean;
  subtotalInside: string;
  account: NoticeAccountLine[];
  notes: NoticeFootnote[];
  /**
   * Where to wire, from the fund's terms, with this investor's reference filled
   * in. Null until the fund has a bank and an account number.
   */
  payment: { label: string; value: string }[] | null;
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
  options: { payment?: { label: string; value: string }[] | null } = {},
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
    const label = (isDeal(c.category) ? 'Investment — ' : '') + c.name;
    (c.reduces ? inside : outside).push({ label, mark: sup(n), amt: fmt(c.amt), neg: false });
  });

  // The fee, and its offset shown as a negative line directly beneath.
  const schedule = result.fee.schedule;
  if ((row.feeGross || row.feeOffset) && schedule) {
    // Billed period by period: say which periods, and this investor's fee for
    // each. No single rate: a step-down or a late close varies it inside a period.
    const parts = schedule
      .map((e, i) => ({ e, amount: row.feeByPeriod?.[i] ?? 0 }))
      .filter((p) => p.amount)
      .map((p) => `${p.e.label} (${fmtDate(p.e.from)} – ${fmtDate(p.e.to)}) ${cur} ${fmt(p.amount)}`);
    const fn = noteFor(
      'fee',
      `The management fee is for ${parts.join('; ')}, worked out on your ${
        result.fee.basis === 'Invested_Capital' ? 'invested capital' : 'commitment'
      } and any fee terms in your side letter${
        row.feeOffset
          ? `, and is shown net of your pro-rata share of an aggregate ${cur} ${fmt(result.fee.offsetTotal)} management fee offset; your net management fee is ${cur} ${fmt(row.feeNet)}`
          : ''
      }.`,
    );
    const feeLines: NoticeLine[] = [{ label: `Management Fee — ${scheduleLabel(schedule)}`, mark: sup(fn), amt: fmt(row.feeGross), neg: false }];
    if (row.feeOffset) feeLines.push({ label: 'Less: Management Fee Offset', mark: sup(fn), amt: fmt(-row.feeOffset), neg: true });
    (result.fee.reduces ? inside : outside).push(...feeLines);
  } else if (row.feeGross || row.feeOffset) {
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

  // Equalization from a later closing, settled here: on top of what the call
  // draws. A schedule marked `settles: 'on_call'` moves the balances on this
  // notice (the account lines show it); an older one moved them on the closing
  // date, and its notes say so.
  const eqEntries = (model.equalizationSchedule ?? [])
    .map((e) => ({ e, amount: num(e.byLp[row.LP_ID] ?? 0) }))
    .filter((x) => x.amount !== 0);
  const equalization: NoticeEqualization[] = eqEntries.map(({ e, amount }) => {
    const onCall = e.settles === 'on_call';
    const interestTo = e.interestUntil && e.interestUntil !== e.closingDate ? ` Late interest runs from each earlier call's due date to ${fmtDate(e.interestUntil)}, this notice's due date.` : '';
    const n = noteFor(
      `eq:${e.closingId}`,
      amount > 0
        ? `You were admitted at Closing ${e.closingNo} on ${fmtDate(e.closingDate)}. The equalization is your share of what investors already in had paid, with any late-close interest and the management fee already billed to them for the time before you joined.${interestTo} ${
            onCall
              ? 'It is contributed with this notice: your paid-in and unfunded commitment move here. Interest is not a contribution and does not count against your commitment.'
              : 'Your capital account has reflected it since that date; this notice collects it.'
          }`
        : `Investors admitted at Closing ${e.closingNo} on ${fmtDate(e.closingDate)} paid their share of what you had already contributed. Your part of that comes back to you as a credit against this notice.${interestTo} ${
            onCall ? 'It is returned with this notice, and restored to your unfunded commitment here.' : 'Your capital account has reflected it since that date.'
          }`,
    );
    const p = e.parts[row.LP_ID] ?? { capital: 0, interest: 0, catchUpFee: 0 };
    const pays = amount > 0;
    const parts = [
      { label: pays ? 'Share of earlier calls' : 'Returned from earlier calls', x: num(p.capital) },
      { label: pays ? 'Late interest' : 'Share of the late interest', x: num(p.interest) },
      { label: pays ? 'Catch-up management fee' : 'Share of the catch-up management fee', x: num(p.catchUpFee) },
      { label: pays ? 'Interest on the catch-up fee' : 'Share of the interest on the catch-up fee', x: num(p.feeInterest ?? 0) },
    ]
      .filter((q) => q.x !== 0)
      .map((q) => ({ label: q.label, amt: fmt(q.x) }));
    return {
      label: `Equalization — Closing ${e.closingNo} (${fmtDate(e.closingDate)})${pays ? '' : ', credited to you'}`,
      mark: sup(n),
      parts,
      total: fmt(amount),
    };
  });

  notes.push(`Amounts are rounded to ${result.d} decimal places.`);

  // An equalization credit can take the call to nothing or past it. Then there
  // is nothing to wire — past it, the fund pays the rest to the investor — and
  // the notice must not ask for money or print where to send it.
  const due = amountDue(row, result.d);
  const nothingDue = equalization.length > 0 && due <= 0;
  const payableToYou = equalization.length > 0 && due < 0;
  const payment = nothingDue ? null : options.payment?.length ? options.payment : null;

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
      // Only say the instructions are enclosed when they are: a request for
      // money that points at wiring details it does not carry is worse than
      // one that says nothing.
      payableToYou
        ? `Nothing is payable by you against this notice: your equalization credit is larger than this call, and ` +
          `the Fund will pay you ${cur} ${fmt(-due)}. If you have any questions regarding this capital call or ` +
          'require any additional information, please do not hesitate to contact us.'
        : nothingDue
        ? 'Nothing is payable against this notice: your equalization credit covers this call. If you have any ' +
          'questions regarding this capital call or require any additional information, please do not ' +
          'hesitate to contact us.'
        : `Kindly ensure that the funds are received by ${dueDate}${
            payment ? ', using the payment instructions above' : ''
          }. If you have any questions ` +
          'regarding this capital call or require any additional information, please do not ' +
          'hesitate to contact us.',
      'Thank you for your continued partnership and support.',
    ],
    callNo,
    callDate: fmtDate(serialToISO(setup.Call_Date)),
    dueDate,
    total: fmt(Math.abs(due)),
    ...(payableToYou ? { payableToYou: true as const } : {}),
    ...(equalization.length ? { called: fmt(row.total), equalization } : {}),
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
      // Equalization settled on this call moves the balances here, so the
      // column adds up on the page. Interest is not a contribution.
      ...(row.eqPaid ? [{ label: row.eqPaid > 0 ? 'Equalization — contributed this notice' : 'Equalization — returned this notice', amt: fmt(row.eqPaid) }] : []),
      { label: 'Total Contributions to Date', amt: fmt(row.closingPaid), strong: true },
      { label: 'Unfunded Commitment — before this call', amt: fmt(row.openUCC) },
      { label: 'Less: applied against commitment this call', amt: fmt(-row.reduces) },
      ...(row.eqReduces ? [{ label: 'Less: equalization applied against commitment', amt: fmt(-row.eqReduces) }] : []),
      { label: 'Unfunded Commitment — after this call', amt: fmt(row.closingUCC), strong: true },
    ],
    notes: notes.map((t, i) => ({ n: i + 1, text: t })),
    payment,
  };
}

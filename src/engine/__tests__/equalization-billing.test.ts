/**
 * Settling a later closing's equalization on the next capital call.
 *
 * The fund: first close 1 Jan 2026, LP01 6m, LP02 4m, GP01 1m (exempt from the
 * fee); 2% on commitment, quarterly. A second close on 1 Aug admits LP07 5m.
 * No call came before it, so the equalization is the catch-up fee alone, and
 * the terms give it to the investors already in:
 *
 *   LP07 pays 5,000,000 × 2% for 1 Jan – 31 Jul = 58,423.91
 *   split by commitment among LP01, LP02 and GP01 (6 : 4 : 1)
 */

import { describe, expect, it } from 'vitest';
import {
  amountDue,
  buildEqualizationSchedule,
  equalizationPartsOf,
  equalizationOwed,
  equalizationScheduleDifferences,
  unsettledClosings,
} from '../equalization-billing';
import { equalize } from '../equalization';
import { equalizationInputFor, type ClosingRecord, type FundHistory, type Settlement } from '../fund-history';
import { BLANK_TERMS, type FundTerms } from '../fund-terms';
import { compute } from '../compute';
import { buildNotice } from '../notice';
import { ILLUSTRATIVE_FUND } from '../fixtures/illustrative-fund';
import type { IssuedCall } from '../positions';
import type { CallModel, EqualizationDueEntry } from '../types';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2026-01-01',
  createdAt: '',
  feeBasis: 'Commitment',
  feeRateAnnual: 0.02,
  feePeriodFraction: 0.25,
  catchUpFeeTo: 'existing_lps',
};
const first: ClosingRecord = {
  id: 'c1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
  commitments: [
    { lpId: 'LP01', name: 'Alpha', amount: 6e6, feeRateOverride: null, feeExempt: false },
    { lpId: 'LP02', name: 'Beta', amount: 4e6, feeRateOverride: null, feeExempt: false },
    { lpId: 'GP01', name: 'GP', amount: 1e6, feeRateOverride: null, feeExempt: true },
  ],
};
const draftSecond: ClosingRecord = {
  id: 'c2', closingNo: 2, closingDate: '2026-08-01', finalised: false, result: null,
  commitments: [{ lpId: 'LP07', name: 'Eta', amount: 5e6, feeRateOverride: null, feeExempt: false }],
};
const result = equalize(equalizationInputFor({ terms: [terms], closings: [first, draftSecond], calls: [] }, 'c2')!);
const net = Object.fromEntries(result.lines.map((l) => [l.lpId, l.net]));

const history = (settlement: Settlement | null, calls: IssuedCall[] = []): FundHistory => ({
  terms: [terms],
  closings: [first, { ...draftSecond, finalised: true, result, settlement }],
  calls,
});
/** Amounts as one part of the equalization — here the catch-up fee, which is all this fixture moves. */
const as = (part: 'capital' | 'interest' | 'catchUpFee', byLp: Record<string, number>) =>
  Object.fromEntries(Object.entries(byLp).map(([id, x]) => [id, { capital: 0, interest: 0, catchUpFee: 0, [part]: x }]));
const sentCall = (callNo: number, byLp: Record<string, number>): IssuedCall => ({
  callNo, callDate: '2026-09-01', dueDate: '2026-09-15', lines: [],
  equalizationSchedule: [{ closingId: 'c2', closingNo: 2, closingDate: '2026-08-01', byLp, parts: as('catchUpFee', byLp) }],
});

describe('the equalization, as the fixture has it', () => {
  it('is the late investor paying the catch-up fee to the investors already in', () => {
    expect(net.LP07).toBe(58_423.91);
    expect(Math.round((net.LP01 + net.LP02 + net.GP01) * 100) / 100).toBe(-58_423.91);
  });
});

describe('what a closing settled on the next call still owes', () => {
  it('is its whole equalization until a call settles any', () => {
    const [c] = equalizationOwed(history('next_call'), '2026-09-01');
    expect(c).toMatchObject({ closingNo: 2, settledOn: [] });
    expect(c.owed).toEqual(net);
  });

  it('is nothing for a closing settled by statement, or not yet chosen', () => {
    expect(equalizationOwed(history('on_closing'), '2026-09-01')).toEqual([]);
    expect(equalizationOwed(history(null), '2026-09-01')).toEqual([]);
  });

  it('is nothing for a call dated before the closing', () => {
    expect(equalizationOwed(history('next_call'), '2026-07-31')).toEqual([]);
  });

  it('is what is left once a sent call settled part of it, and ignores the call being worked on', () => {
    const part = sentCall(3, { LP07: net.LP07, LP01: -10_000 });
    const [c] = equalizationOwed(history('next_call', [part]), '2026-10-01');
    expect(c.settledOn).toEqual([{ callNo: 3, amount: Math.round((net.LP07 - 10_000) * 100) / 100 }]);
    expect(c.owed.LP07).toBeUndefined();
    expect(c.owed.LP01).toBe(Math.round((net.LP01 + 10_000) * 100) / 100);
    expect(equalizationOwed(history('next_call', [part]), '2026-10-01', 3)[0].owed).toEqual(net);
  });
});

describe('what a call settles', () => {
  const owed = equalizationOwed(history('next_call'), '2026-09-01');

  it('settles all of it on one call: every late investor’s amount and every credit, in full', () => {
    const [e] = buildEqualizationSchedule(owed);
    expect(e.byLp).toEqual(net);
    // Taken apart: here all of it is the catch-up fee, since no call came before the close.
    expect(e.parts).toEqual(as('catchUpFee', net));
    // GP01 pays no fee, so its call is nothing — its credit is still settled, not held back.
    expect(e.byLp.GP01).toBe(net.GP01);
  });

  it('says where a saved schedule no longer matches the record', () => {
    const [fresh] = buildEqualizationSchedule(owed);
    expect(equalizationScheduleDifferences([fresh], [fresh])).toEqual([]);
    expect(equalizationScheduleDifferences([], [fresh])).toEqual(["Closing 2's equalization is not on this call."]);
    expect(equalizationScheduleDifferences([fresh], [])).toEqual(["Closing 2's equalization is on this call, but nothing of it is owed."]);
    const moved = { ...fresh, byLp: { ...fresh.byLp, LP07: 1 } };
    expect(equalizationScheduleDifferences([moved], [fresh])).toEqual(['Closing 2: LP07 is 1.00 on this call; the record says 58,423.91.']);
    // The same total, with the parts in the wrong place, is not the record either.
    const misfiled = { ...fresh, parts: { ...fresh.parts, LP07: { capital: net.LP07, interest: 0, catchUpFee: 0 } } };
    expect(equalizationScheduleDifferences([misfiled], [fresh])).toEqual([
      "Closing 2: LP07's capital, interest and catch-up fee on this call differ from the record.",
    ]);
  });
});

describe('a closing nobody has said how to settle', () => {
  it('holds back calls after it, and only those', () => {
    expect(unsettledClosings(history(null), '2026-09-01')).toEqual([{ closingNo: 2, closingDate: '2026-08-01' }]);
    expect(unsettledClosings(history(null), '2026-07-31')).toEqual([]);
    expect(unsettledClosings(history('next_call'), '2026-09-01')).toEqual([]);
  });
});

describe('a call settling equalization', () => {
  // The illustrative call, with a made-up equalization on its first two investors.
  const base = structuredClone(ILLUSTRATIVE_FUND);
  base.golden = null;
  const [a, b] = base.lps.map((l) => String(l.LP_ID));
  const settles = (byLp: Record<string, number>): CallModel => ({
    ...structuredClone(base),
    equalizationSchedule: [{ closingId: 'c2', closingNo: 2, closingDate: '2026-08-01', byLp, parts: as('capital', byLp) }],
  });
  const plain = compute(base);

  it('adds it to what is due, and leaves what the call draws — and the balances — as they were', () => {
    const r = compute(settles({ [a]: 1_000, [b]: -500 }));
    const [ra, rb] = [r.rows.find((x) => x.LP_ID === a)!, r.rows.find((x) => x.LP_ID === b)!];
    const [pa, pb] = [plain.rows.find((x) => x.LP_ID === a)!, plain.rows.find((x) => x.LP_ID === b)!];
    expect(ra.equalization).toBe(1_000);
    expect(amountDue(ra)).toBe(Math.round((pa.total + 1_000) * 100) / 100);
    expect(amountDue(rb)).toBe(Math.round((pb.total - 500) * 100) / 100);
    expect(r.totals).toEqual(plain.totals);
    expect(ra.closingPaid).toBe(pa.closingPaid);
    expect(ra.closingUCC).toBe(pa.closingUCC);
    expect(r.equalization).toEqual({
      closings: [{ closingId: 'c2', closingNo: 2, closingDate: '2026-08-01', paid: 1_000, credited: 500, capital: 500, interest: 0, catchUpFee: 0 }],
      total: 500,
    });
    expect(r.checks).toContainEqual({ level: 'info', text: 'Equalization from Closing 2: 1,000.00 collected from late investors, 500.00 credited to earlier investors.' });
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
  });

  it('pays out a credit larger than the call, and says who is paid what', () => {
    const pb = plain.rows.find((x) => x.LP_ID === b)!;
    const r = compute(settles({ [b]: -(pb.total + 1_000) }));
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(amountDue(r.rows.find((x) => x.LP_ID === b)!)).toBe(-1_000);
    expect(r.checks).toContainEqual({ level: 'info', text: `Paid out on this call, the equalization credit beyond what they are called: ${b} 1,000.00.` });
  });

  it('tells an investor paid out that the fund pays them, and asks for nothing', () => {
    const pb = plain.rows.find((x) => x.LP_ID === b)!;
    const model = settles({ [b]: -(pb.total + 1_000) });
    const r = compute(model);
    const notice = buildNotice(model, r, r.rows.find((x) => x.LP_ID === b)!, { payment: [{ label: 'Bank', value: 'First Harbour' }] });
    expect(notice.payableToYou).toBe(true);
    expect(notice.total).toBe('1,000.00');
    expect(notice.payment).toBeNull();
    expect(notice.closing[0]).toMatch(/the Fund will pay you USD 1,000\.00/);
  });

  it('refuses someone not on the register', () => {
    const r = compute(settles({ LP99: 100 }));
    expect(r.checks.filter((c) => c.level === 'fail').map((c) => c.text)).toEqual([
      "The equalization on this call names LP99, who is not on this call's register.",
    ]);
  });

  it('is a line of its own on the notice, under what the call draws, with the amount due below', () => {
    const model = settles({ [a]: 1_000 });
    const r = compute(model);
    const row = r.rows.find((x) => x.LP_ID === a)!;
    const notice = buildNotice(model, r, row);
    expect(notice.called).toBe(buildNotice(base, plain, plain.rows.find((x) => x.LP_ID === a)!).total);
    expect(notice.equalization).toEqual([
      expect.objectContaining({ label: 'Equalization — Closing 2 (1 August 2026)', parts: [{ label: 'Share of earlier calls', amt: '1,000.00' }], total: '1,000.00' }),
    ]);
    expect(notice.total).toBe(new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amountDue(row)));
    expect(notice.notes.some((n) => n.text.startsWith('You were admitted at Closing 2 on 1 August 2026.'))).toBe(true);
  });

  it('asks for nothing, and prints no wiring details, when a credit takes the call to nothing', () => {
    const pb = plain.rows.find((x) => x.LP_ID === b)!;
    const model = settles({ [b]: -pb.total });
    const r = compute(model);
    const payment = [{ label: 'Bank', value: 'First Harbour' }];
    const notice = buildNotice(model, r, r.rows.find((x) => x.LP_ID === b)!, { payment });
    expect(notice.total).toBe('0.00');
    expect(notice.payment).toBeNull();
    expect(notice.closing[0]).toMatch(/^Nothing is payable against this notice/);
    // One that still owes something keeps them.
    const owes = buildNotice(settles({ [a]: 1_000 }), compute(settles({ [a]: 1_000 })), compute(settles({ [a]: 1_000 })).rows.find((x) => x.LP_ID === a)!, { payment });
    expect(owes.payment).toEqual(payment);
    expect(owes.closing[0]).toMatch(/^Kindly ensure/);
  });

  it('refuses a schedule whose parts do not add up to the amount', () => {
    const model: CallModel = {
      ...structuredClone(base),
      equalizationSchedule: [{ closingId: 'c2', closingNo: 2, closingDate: '2026-08-01', byLp: { [a]: 1_000 }, parts: as('capital', { [a]: 900 }) }],
    };
    expect(compute(model).checks.filter((c) => c.level === 'fail').map((c) => c.text)).toEqual([
      `Closing 2: ${a}'s equalization does not add up to its capital, interest and catch-up fee.`,
    ]);
  });

  it('shows each part on the notice for the side the investor is on', () => {
    const parts = { [b]: { capital: -400, interest: -50, catchUpFee: -25 } };
    const model: CallModel = { ...structuredClone(base), equalizationSchedule: [{ closingId: 'c2', closingNo: 2, closingDate: '2026-08-01', byLp: { [b]: -475 }, parts }] };
    const r = compute(model);
    expect(r.equalization!.closings[0]).toMatchObject({ capital: -400, interest: -50, catchUpFee: -25 });
    const [eq] = buildNotice(model, r, r.rows.find((x) => x.LP_ID === b)!).equalization!;
    expect(eq.label).toBe('Equalization — Closing 2 (1 August 2026), credited to you');
    expect(eq.parts).toEqual([
      { label: 'Returned from earlier calls', amt: '(400.00)' },
      { label: 'Share of the late interest', amt: '(50.00)' },
      { label: 'Share of the catch-up management fee', amt: '(25.00)' },
    ]);
    expect(eq.total).toBe('(475.00)');
  });

  it('leaves a notice with none exactly as it was', () => {
    const notice = buildNotice(base, plain, plain.rows[0]);
    expect('called' in notice).toBe(false);
    expect('equalization' in notice).toBe(false);
    expect('equalization' in plain).toBe(false);
    expect('equalization' in plain.rows[0]).toBe(false);
  });
});

describe('an investor’s equalization on a call, taken apart', () => {
  it('adds each part across every closing the call settles', () => {
    const schedule: EqualizationDueEntry[] = [
      { closingId: 'c2', closingNo: 2, closingDate: '2026-05-01', byLp: { A: 110 }, parts: { A: { capital: 100, interest: 5, catchUpFee: 5 } } },
      { closingId: 'c3', closingNo: 3, closingDate: '2026-07-01', byLp: { A: -40, B: 7 }, parts: { A: { capital: -30, interest: -2.5, catchUpFee: -7.5 }, B: { capital: 0, interest: 0, catchUpFee: 7 } } },
    ];
    expect(equalizationPartsOf(schedule, 'A')).toEqual({ capital: 70, interest: 2.5, catchUpFee: -2.5 });
    expect(equalizationPartsOf(schedule, 'B')).toEqual({ capital: 0, interest: 0, catchUpFee: 7 });
    expect(equalizationPartsOf(null, 'A')).toEqual({ capital: 0, interest: 0, catchUpFee: 0 });
  });
});

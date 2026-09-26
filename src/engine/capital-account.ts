/**
 * One investor's capital account: everything the fund did that moved their
 * commitment, paid-in or unfunded, in date order, with the balance after each.
 *
 * For a fund whose record can be trusted — it has finalised closings and its
 * calls agree with them — the account is built from the record, the same way
 * `positionsOn` is, and ends on the same figures. For any other fund the calls'
 * registers are the only record, so each call's frozen line is shown as it
 * was issued: its opening balances, what it called, and its closing balances.
 *
 * The management fee is inside each call that billed it, so it is not added
 * again from the fee ledger.
 */

import { round } from './format';
import { registerMismatches } from './fund-register';
import type { FundHistory } from './fund-history';
import { termsOn } from './fund-terms';

export interface AccountEntry {
  date: string;
  kind: 'opening' | 'closing' | 'call' | 'equalization';
  label: string;
  /** Change to what they have committed. */
  commitment: number;
  /** Change to what they have paid in. */
  paid: number;
  /** The part of `paid` that counted against their commitment. */
  drawn: number;
  /** Late-close interest paid (+) or received (−): not capital, so no balance moves. */
  interest: number;
  /** Balances after this entry. */
  commitmentAfter: number;
  paidAfter: number;
  unfundedAfter: number;
  ref: { callNo?: number; closingId?: string; closingNo?: number };
}

/**
 * How a closing's equalization reached the investor, for the account's label.
 * The balances move on the closing date either way; this says where the cash is.
 */
function settledHow(c: FundHistory['closings'][number], calls: FundHistory['calls']): string {
  if (c.settlement === 'on_closing') return ', by statement';
  if (c.settlement === 'next_call') {
    const on = calls.filter((call) => call.equalizationSchedule?.some((e) => e.closingId === c.id)).map((call) => call.callNo);
    return on.length ? `, settled on Call No. ${on.join(', ')}` : ', due on the next call';
  }
  return ', settlement not chosen';
}

export interface CapitalAccount {
  entries: AccountEntry[];
  /** True when built from the record; false when each call's frozen line is shown instead. */
  fromRecord: boolean;
}

export function capitalAccount(history: FundHistory, lpId: string, through: string, decimals = 2): CapitalAccount {
  const r = (n: number) => round(n, decimals);
  const calls = history.calls
    .filter((c) => c.callDate <= through)
    .sort((a, b) => a.callDate.localeCompare(b.callDate) || a.callNo - b.callNo);
  const finalised = history.closings
    .filter((c) => c.finalised && c.closingDate <= through)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.closingNo - b.closingNo);
  const fromRecord = finalised.length > 0 && registerMismatches(history).length === 0;

  if (!fromRecord) {
    // Each call as it was issued. Its opening is its own, not worked out.
    const entries = calls.flatMap((c): AccountEntry[] => {
      const l = c.lines.find((x) => x.lpId === lpId);
      if (!l) return [];
      return [
        {
          date: c.callDate,
          kind: 'call',
          label: `Capital Call No. ${c.callNo}`,
          commitment: 0,
          paid: l.total,
          drawn: l.reduces,
          interest: 0,
          commitmentAfter: l.commitment,
          paidAfter: r(l.openPaid + l.total),
          unfundedAfter: r(l.openUnfunded - l.reduces),
          ref: { callNo: c.callNo },
        },
      ];
    });
    return { entries, fromRecord: false };
  }

  type Step = Omit<AccountEntry, 'commitmentAfter' | 'paidAfter' | 'unfundedAfter'>;
  const steps: Step[] = [];

  // History from before the fund was on Axtara: the first call's own opening.
  const opening = calls[0]?.lines.find((x) => x.lpId === lpId);
  if (opening && (opening.openPaid || opening.commitment - opening.openUnfunded)) {
    steps.push({
      date: calls[0].callDate,
      kind: 'opening',
      label: 'Brought forward, before the first call here',
      commitment: 0,
      paid: opening.openPaid,
      drawn: opening.commitment - opening.openUnfunded,
      interest: 0,
      ref: {},
    });
  }

  for (const c of finalised) {
    const amount = c.commitments.filter((k) => k.lpId === lpId).reduce((s, k) => s + k.amount, 0);
    if (amount) {
      steps.push({ date: c.closingDate, kind: 'closing', label: `Closing ${c.closingNo}: committed`, commitment: amount, paid: 0, drawn: 0, interest: 0, ref: { closingId: c.id, closingNo: c.closingNo } });
    }
    const line = c.result?.lines.find((l) => l.lpId === lpId);
    if (line) {
      const feeReduces = termsOn(history.terms, c.closingDate)?.feeReducesUnfunded ?? true;
      steps.push({
        date: c.closingDate,
        kind: 'equalization',
        label: `Closing ${c.closingNo}: equalization ${line.net >= 0 ? 'paid' : 'refund'}${settledHow(c, calls)}`,
        commitment: 0,
        paid: line.capital + line.catchUpFee,
        drawn: line.inside + (feeReduces ? line.catchUpFee : 0),
        interest: line.interest,
        ref: { closingId: c.id, closingNo: c.closingNo },
      });
    }
  }

  for (const c of calls) {
    const l = c.lines.find((x) => x.lpId === lpId);
    if (l) steps.push({ date: c.callDate, kind: 'call', label: `Capital Call No. ${c.callNo}`, commitment: 0, paid: l.total, drawn: l.reduces, interest: 0, ref: { callNo: c.callNo } });
  }

  // Same-day order: what was brought forward, then the commitment, then what moved against it.
  const rank = { opening: 0, closing: 1, equalization: 2, call: 3 };
  steps.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind]);

  let commitment = 0;
  let paid = 0;
  let drawn = 0;
  const entries = steps.map((s): AccountEntry => {
    commitment += s.commitment;
    paid += s.paid;
    drawn += s.drawn;
    return { ...s, commitmentAfter: r(commitment), paidAfter: r(paid), unfundedAfter: r(commitment - drawn) };
  });
  return { entries, fromRecord: true };
}

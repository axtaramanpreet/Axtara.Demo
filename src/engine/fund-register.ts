/**
 * The next call's register, from the fund's record.
 *
 * Carrying the register forward from the previous call is right until the fund
 * holds a later close. After one, the previous call is out of date: it has no
 * row for the investors the close admitted, and it still shows the earlier
 * investors' paid-in before the equalization refunded part of it. The record —
 * closings, issued calls and equalizations — has both, so the register is read
 * from there instead.
 *
 * The record carries figures only. Everything else about an investor (type,
 * contact, side-letter reference, notes) comes from their row on the previous
 * call, or for someone new, from the closing that admitted them.
 *
 * Transfers are the limit. A transfer is applied inside a call, and closings
 * know nothing of it, so after one the calls and the closings disagree about
 * who has committed what. Rather than pick one and be quietly wrong, the
 * register is refused, and the disagreement named.
 */

import { carryForwardRegister } from './carry-forward';
import { fmt, num } from './format';
import { feeInvestorsFrom, positionsOn, type FundHistory } from './fund-history';
import type { CallModel, LPRow } from './types';

/**
 * Where an issued call's register and the closings disagree about a
 * commitment. Empty when they agree, or when the fund has no closings to
 * disagree with.
 *
 * A call is compared with the closings in force on its date. A call from
 * before the first close — history from before the fund was on Axtara — is
 * compared with the first close, which recorded the register as it stood.
 */
export function registerMismatches(history: FundHistory): string[] {
  const finalised = history.closings
    .filter((c) => c.finalised)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.closingNo - b.closingNo);
  if (!finalised.length) return [];

  const out: string[] = [];
  for (const call of [...history.calls].sort((a, b) => a.callDate.localeCompare(b.callDate) || a.callNo - b.callNo)) {
    const inForce = finalised.filter((c) => c.closingDate <= call.callDate);
    const expected = new Map<string, number>();
    for (const c of inForce.length ? inForce : [finalised[0]]) {
      for (const k of c.commitments) expected.set(k.lpId, (expected.get(k.lpId) ?? 0) + k.amount);
    }
    const actual = new Map(call.lines.map((l) => [l.lpId, l.commitment]));

    for (const lpId of [...new Set([...expected.keys(), ...actual.keys()])].sort()) {
      const want = expected.get(lpId) ?? 0;
      const have = actual.get(lpId) ?? 0;
      if (Math.abs(want - have) < 0.005) continue;
      out.push(
        `Call No. ${call.callNo} has ${lpId} committed at ${fmt(have)}, but the closings say ${fmt(want)}.`,
      );
    }
  }
  return out;
}

export type FundRegister =
  | { ok: true; lps: LPRow[]; asOf: string }
  | { ok: false; problems: string[] };

/**
 * Every investor with a commitment on `date`, with their paid-in, unfunded and
 * invested capital from the record as that call's opening balances.
 *
 * @param previous The fund's previous call, for the details the record does
 *                 not hold. Null for a fund's first call.
 */
export function fundRegister(history: FundHistory, date: string, previous: CallModel | null): FundRegister {
  const problems = registerMismatches(history);
  if (problems.length) return { ok: false, problems };

  const details = new Map((previous ? carryForwardRegister(previous) : []).map((r) => [r.LP_ID, r]));
  const fees = new Map(feeInvestorsFrom(history).map((i) => [i.lpId, i]));
  const hasClosings = history.closings.some((c) => c.finalised);

  // The latest closing that names an investor has their current name and contact.
  const admitted = new Map<string, { name: string; contactEmail?: string | null }>();
  for (const c of history.closings
    .filter((x) => x.finalised && x.closingDate <= date)
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate))) {
    for (const k of c.commitments) admitted.set(k.lpId, { name: k.name, contactEmail: k.contactEmail });
  }

  const lps = positionsOn(history, date)
    .filter((p) => p.commitment > 0)
    .map((p): LPRow => {
      const before = details.get(p.lpId);
      const fee = fees.get(p.lpId);
      const closing = admitted.get(p.lpId);
      return {
        LP_ID: p.lpId,
        LP_Name: closing?.name ?? before?.LP_Name ?? p.name,
        LP_Type: before?.LP_Type ?? '',
        Commitment: p.commitment,
        Opening_Paid_In: p.paidIn,
        Opening_UCC: p.unfunded,
        Opening_Invested_Capital: p.invested,
        // With closings, a side letter is recorded on the commitment; without,
        // the previous call's register is the only record of one.
        Mgmt_Fee_Rate_Override: hasClosings ? (fee?.feeRateOverride ?? '') : (before?.Mgmt_Fee_Rate_Override ?? ''),
        Fee_Exempt: hasClosings ? (fee?.feeExempt ? 'Y' : 'N') : (before?.Fee_Exempt ?? 'N'),
        Status: 'Active',
        Side_Letter_Ref: before?.Side_Letter_Ref ?? '',
        Contact_Email: before?.Contact_Email || closing?.contactEmail || '',
        Notes: before?.Notes ?? '',
      };
    });

  return { ok: true, lps, asOf: date };
}

/**
 * The fund's totals from the record — for a fund whose record can be trusted
 * to be complete: it has finalised closings, and its calls agree with them.
 *
 * Null otherwise, and the caller keeps reading the latest call's register. A
 * fund with no closings has only its calls' registers as the record of who
 * committed what, including balances brought in from a workbook and moved by
 * transfers, which the record read from closings does not see.
 */
export function positionFromRecord(
  history: FundHistory,
  date: string,
): { totalCommitments: number; paidInCapital: number; unfundedCommitment: number; investors: number } | null {
  if (!history.closings.some((c) => c.finalised) || registerMismatches(history).length) return null;
  const held = positionsOn(history, date).filter((p) => p.commitment > 0);
  return {
    totalCommitments: held.reduce((s, p) => s + p.commitment, 0),
    paidInCapital: held.reduce((s, p) => s + p.paidIn, 0),
    unfundedCommitment: held.reduce((s, p) => s + p.unfunded, 0),
    investors: held.length,
  };
}

export interface RegisterDifference {
  lpId: string;
  kind: 'unknown' | 'missing' | 'commitment' | 'paidIn' | 'unfunded';
  /** What the call's register says, and what the record says. */
  register: number | null;
  record: number | null;
  text: string;
}

/**
 * Where a call's register disagrees with the fund's record, investor by
 * investor: someone the fund never admitted, someone missing, or a commitment,
 * paid-in or unfunded balance that is not what the record says it was on the
 * call's date. Empty when they agree, and for a fund with no closings, whose
 * registers are the only record there is.
 *
 * `history` is the record before this call: its closings, and the calls issued
 * before it.
 */
export function registerDifferences(history: FundHistory, lps: LPRow[], callDate: string): RegisterDifference[] {
  if (!history.closings.some((c) => c.finalised)) return [];
  const record = new Map(positionsOn(history, callDate).filter((p) => p.commitment > 0).map((p) => [p.lpId, p]));
  const active = lps.filter((l) => String(l.LP_ID ?? '').trim() && String(l.Status || 'Active') === 'Active');
  const out: RegisterDifference[] = [];
  const differs = (a: number, b: number) => Math.abs(a - b) >= 0.005;

  for (const l of active) {
    const lpId = String(l.LP_ID).trim();
    const p = record.get(lpId);
    if (!p) {
      out.push({ lpId, kind: 'unknown', register: num(l.Commitment), record: null, text: `${lpId} is on this register, but no closing admitted them.` });
      continue;
    }
    const checks: [RegisterDifference['kind'], string, number, number][] = [
      ['commitment', 'commitment', num(l.Commitment), p.commitment],
      ['paidIn', 'paid in before this call', num(l.Opening_Paid_In), p.paidIn],
      ['unfunded', 'unfunded before this call', num(l.Opening_UCC), p.unfunded],
    ];
    for (const [kind, what, register, value] of checks) {
      if (differs(register, value)) {
        out.push({ lpId, kind, register, record: value, text: `${lpId} ${what}: ${fmt(register)} here, ${fmt(value)} in the fund's record.` });
      }
    }
  }
  const listed = new Set(active.map((l) => String(l.LP_ID).trim()));
  for (const p of record.values()) {
    if (!listed.has(p.lpId)) {
      out.push({ lpId: p.lpId, kind: 'missing', register: null, record: p.commitment, text: `${p.lpId} is in the fund (${fmt(p.commitment)} committed) but not on this register.` });
    }
  }
  return out;
}

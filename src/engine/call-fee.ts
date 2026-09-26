/**
 * Which fee period a call's management fee covers, and whether an earlier call
 * already charged it.
 *
 * A call's fee is a period's share of the year's fee — a quarter's, most
 * often — for the period its date falls in. Two calls in one quarter would each
 * charge that quarter, so the second has to leave it out.
 */

import { periodContaining, periodLabel, periodMonths } from './dates';
import { num, round } from './format';
import type { CallModel } from './types';
import type { IssuedCall } from './positions';

export interface CallFeePeriod {
  from: string;
  to: string;
  label: string;
}

/** The fee period a call dated `callDate` charges, for a fee charged `fraction` of a year at a time. */
export function callFeePeriod(callDate: string, fraction: number | null): CallFeePeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(callDate)) return null;
  const months = periodMonths(fraction);
  const p = periodContaining(callDate, months);
  return { ...p, label: periodLabel(p.from, months) };
}

/**
 * Earlier issued calls that charged a fee in the same period, with how much.
 * The fee on an issued call is what it called beyond capital.
 */
export function feeAlreadyCharged(calls: IssuedCall[], period: CallFeePeriod, callNo: number): { callNo: number; callDate: string; fee: number }[] {
  return calls
    .filter((c) => c.callNo !== callNo && c.callDate >= period.from && c.callDate <= period.to)
    .map((c) => ({ callNo: c.callNo, callDate: c.callDate, fee: round(c.lines.reduce((s, l) => s + (l.total - l.capital), 0), 2) }))
    .filter((c) => c.fee > 0);
}

/** The share of a year's fee a call charges, as the engine reads it: the fee tab first, then Fund_Setup. */
export function feeFraction(model: CallModel): number | null {
  const raw = model.fee.Fee_Period_Fraction !== '' && model.fee.Fee_Period_Fraction != null ? model.fee.Fee_Period_Fraction : model.setup.Mgmt_Fee_Period_Fraction;
  return raw === '' || raw == null ? null : num(raw);
}

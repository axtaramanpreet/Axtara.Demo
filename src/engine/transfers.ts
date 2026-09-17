/**
 * Secondary transfers between investors, applied before any allocation.
 *
 * A transfer moves part or all of one LP's position to another. It has to run
 * first, because it changes who is in the register and what their commitment,
 * paid-in and unfunded balances are — which is exactly what every subsequent
 * allocation is measured against.
 */

import { fmtDate, num, round, serialToISO, yes } from './format';
import type { AppliedTransfer, LPRow, SkippedTransfer, TransferResult, TransferRow } from './types';

/** Balance fields a transfer can move between LPs. */
type MovableField =
  | 'Commitment'
  | 'Opening_Invested_Capital'
  | 'Opening_Paid_In'
  | 'Opening_UCC';

/**
 * Apply every transfer that is effective on or before the call date.
 *
 * Transfers dated after the call date are reported as skipped rather than
 * dropped, so the accountant can see the engine knew about them and chose not
 * to apply them yet.
 *
 * The input register is never mutated — the roster is a shallow copy — so
 * callers can safely recompute from the same model repeatedly.
 *
 * @param lps        The LP register as entered.
 * @param transfers  Transfers to consider.
 * @param callDate   ISO call date. Transfers after this are skipped.
 * @param d          Decimal places for rounding moved balances.
 * @returns The roster as at the call date, plus what was applied and skipped.
 */
export function applyTransfers(
  lps: LPRow[],
  transfers: TransferRow[],
  callDate: string,
  d: number,
): TransferResult {
  const roster: LPRow[] = lps.map((l) => ({ ...l }));
  const applied: AppliedTransfer[] = [];
  const skipped: SkippedTransfer[] = [];

  for (const t of transfers) {
    const eff = serialToISO(t.Effective_Date);
    const from = roster.find((l) => l.LP_ID === t.From_LP_ID);

    // A blank row in the Transfers tab is not an error worth reporting.
    if (!t.From_LP_ID || !t.To_LP_ID) continue;

    if (!from) {
      skipped.push({ t, why: `From_LP_ID ${t.From_LP_ID} not in register` });
      continue;
    }

    // Not yet effective as at this call. It will apply to a later one.
    if (eff && callDate && eff > callDate) {
      skipped.push({ t, why: `effective ${fmtDate(eff)}, after call date` });
      continue;
    }

    const full = String(t.Transfer_Type || '').toLowerCase() === 'full';
    const pctMoved = full ? 1 : num(t.Transfer_Pct);
    if (pctMoved <= 0 || pctMoved > 1) {
      skipped.push({ t, why: 'Transfer_Pct must be between 0 and 1' });
      continue;
    }

    // The transferee may be new to the fund. Add them to the roster with a zero
    // position — the moves below fill it in — and inherit the transferor's type.
    let to = roster.find((l) => l.LP_ID === t.To_LP_ID);
    if (!to) {
      to = {
        LP_ID: t.To_LP_ID,
        LP_Name: t.To_LP_Name_if_new || t.To_LP_ID,
        LP_Type: from.LP_Type,
        Commitment: 0,
        Opening_Paid_In: 0,
        Opening_UCC: 0,
        Opening_Invested_Capital: 0,
        Mgmt_Fee_Rate_Override: '',
        Fee_Exempt: 'N',
        Status: 'Active',
        Side_Letter_Ref: '',
        Notes: `Transferee of ${from.LP_ID} (${t.Transfer_ID})`,
      };
      roster.push(to);
    }

    // Move one balance field across, rounding the moved amount and both
    // resulting balances so no sub-cent dust accumulates on the register.
    const transferee = to;
    const move = (field: MovableField): number => {
      const moved = round(num(from[field]) * pctMoved, d);
      from[field] = round(num(from[field]) - moved, d);
      transferee[field] = round(num(transferee[field]) + moved, d);
      return moved;
    };

    // Which balances move is driven by the Y/N flags on the transfer row.
    // Invested capital follows commitment: a partner taking over a commitment
    // takes over the capital already invested through it.
    const moved: Partial<Record<string, number>> = {};
    if (yes(t.Transfers_Commitment)) {
      moved.Commitment = move('Commitment');
      moved.Opening_Invested_Capital = move('Opening_Invested_Capital');
    }
    if (yes(t.Transfers_Paid_In)) moved.Opening_Paid_In = move('Opening_Paid_In');
    if (yes(t.Transfers_UCC)) moved.Opening_UCC = move('Opening_UCC');

    // A full transfer takes the transferor out of the fund. They stay on the
    // roster (so history and the allocation table still show them) but drop out
    // of `active`, so nothing is called from them.
    if (full) from.Status = 'Transferred';

    applied.push({ t, moved, pct: pctMoved });
  }

  return { roster, applied, skipped };
}

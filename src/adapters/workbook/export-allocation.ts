/**
 * Writes the allocation back out as a workbook.
 *
 * An accountant's next step after reviewing a call is usually to reconcile it
 * against their own model, so the Allocation sheet keeps the column order of
 * the template's Expected_Output tab: the two can be diffed directly.
 *
 * The Checks sheet travels with it, because a file of figures with no record of
 * what was verified is a file somebody will eventually trust more than they
 * should.
 */

import type { CallDetail } from '@/adapters/storage/types';
import { amountDue, equalizationPartsOf, num, round, type ComputeResult, scheduleLabel } from '@/engine';

/** Build the workbook and hand it to the browser as a download. */
export async function exportAllocation(call: CallDetail, result: ComputeResult): Promise<void> {
  const XLSX = await import('xlsx');

  const components = call.model.components.filter((c) => c.Component_ID);
  // Columns for a later closing's equalization only on a call that settles some,
  // so every other export keeps the Expected_Output shape exactly.
  const eq = result.equalization;
  const header = [
    'LP_ID',
    'LP_Name',
    'Commitment',
    'Opening_UCC',
    'Opening_Paid_In',
    ...components.map((c) => String(c.Component_Name)),
    result.fee.schedule ? 'Fee_Periods' : 'Fee_Rate',
    'Fee_Gross',
    'Fee_Offset',
    'Fee_Net',
    'Total_Call',
    ...(eq ? ['Eq_Capital', 'Eq_Interest', 'Eq_Catch_Up_Fee', 'Equalization', 'Amount_Due'] : []),
    'Reduces_Unfunded_Amt',
    'Closing_UCC',
    'Closing_Paid_In',
    'Status',
  ];

  const rows = result.rows.map((row) => [
    row.LP_ID,
    row.LP_Name,
    num(row.Commitment),
    row.openUCC,
    row.openPaid,
    ...components.map((c) => {
      const cell = row.comps.find((x) => x.id === c.Component_ID);
      // Written as text, so a reader cannot mistake an excusal for a zero.
      return cell?.excused ? 'excused' : (cell?.amt ?? 0);
    }),
    result.fee.schedule ? scheduleLabel(result.fee.schedule) : row.feeRate,
    row.feeGross,
    row.feeOffset,
    row.feeNet,
    row.total,
    ...(eq
      ? (() => {
          const p = equalizationPartsOf(call.model.equalizationSchedule, row.LP_ID, result.d);
          return [p.capital, p.interest, p.catchUpFee, row.equalization ?? 0, amountDue(row, result.d)];
        })()
      : []),
    row.reduces,
    row.closingUCC,
    row.closingPaid,
    row.isActive ? 'Active' : String(row.Status),
  ]);

  const totals = [
    'TOTAL',
    '',
    result.totals.Commitment,
    result.totals.openUCC,
    result.totals.openPaid,
    ...components.map((_, i) => result.totals.comps[i] ?? 0),
    '',
    result.totals.feeGross,
    result.totals.feeOffset,
    result.totals.feeNet,
    result.totals.total,
    ...(eq
      ? [
          round(eq.closings.reduce((t, c) => t + c.capital, 0), result.d),
          round(eq.closings.reduce((t, c) => t + c.interest, 0), result.d),
          round(eq.closings.reduce((t, c) => t + c.catchUpFee, 0), result.d),
          eq.total,
          round(result.totals.total + eq.total, result.d),
        ]
      : []),
    result.totals.reduces,
    result.totals.closingUCC,
    result.totals.closingPaid,
    '',
  ];

  const allocation = XLSX.utils.aoa_to_sheet([
    [`${call.model.setup.Fund_Name} — Capital Call No. ${call.callNo}`],
    [
      `Notice date ${String(call.model.setup.Call_Date ?? '')} · payment due ${String(
        call.model.setup.Payment_Due_Date ?? '',
      )} · amounts in ${call.model.setup.Reporting_Currency}`,
    ],
    [],
    header,
    ...rows,
    totals,
  ]);

  const checks = XLSX.utils.aoa_to_sheet([
    ['Level', 'Check'],
    ...result.checks.map((c) => [c.level.toUpperCase(), c.text]),
    ...(result.goldenDiffs.length
      ? [
          [],
          ['Differences from Expected_Output'],
          ['LP', 'Field', 'Expected', 'Engine'],
          ...result.goldenDiffs.map((d) => [d.lp, d.field, d.expected, d.actual]),
        ]
      : []),
  ]);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, allocation, 'Allocation');
  XLSX.utils.book_append_sheet(book, checks, 'Checks');

  const name = `Capital_Call_${String(call.callNo).padStart(2, '0')}_Allocation.xlsx`;
  XLSX.writeFile(book, name, { compression: true });
}

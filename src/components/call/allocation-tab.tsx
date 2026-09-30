'use client';

import { useState } from 'react';
import { amountDue, equalizationPartsOf, fmt, pct, round, type ComputeResult, scheduleLabel } from '@/engine';
import type { CallDetail } from '@/adapters/storage/types';
import { Button } from '@/components/ui/button';

/**
 * The allocation, shaped exactly like the accountant's Expected_Output tab.
 *
 * Same columns, same order, so it can be read side by side with the workbook
 * it has to agree with. That is the whole point of this tab: not a prettier
 * view of the numbers, but the same view, checkable line by line.
 */
export function AllocationTab({ call, result }: { call: CallDetail; result: ComputeResult }) {
  const [exporting, setExporting] = useState(false);
  const components = call.model.components.filter((c) => c.Component_ID);
  // A call settling a later closing's equalization: cash on top of what it calls.
  const eq = result.equalization;
  // The fee periods it bills, each its own column, in the schedule's order.
  const periods = result.fee.schedule ?? [];

  async function onExport() {
    setExporting(true);
    try {
      const { exportAllocation } = await import('@/adapters/workbook/export-allocation');
      await exportAllocation(call, result);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}
      >
        <p className="text-muted" style={{ margin: 0, fontSize: 13, maxWidth: 680 }}>
          Every figure the engine produced, in the shape of the Expected_Output tab. Investors who
          left through a transfer are shown faded; cells an investor is excused from read
          &ldquo;excused&rdquo;.
        </p>
        <Button variant="secondary" onClick={onExport} disabled={exporting} style={{ marginLeft: 'auto' }}>
          {exporting ? 'Preparing…' : 'Download allocation (.xlsx)'}
        </Button>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              <th>LP_ID</th>
              <th>LP_Name</th>
              <th style={{ textAlign: 'right' }}>Commitment</th>
              <th style={{ textAlign: 'right' }}>Opening_UCC</th>
              <th style={{ textAlign: 'right' }}>Opening_Paid_In</th>
              {components.map((c) => (
                <th key={c.Component_ID} style={{ textAlign: 'right' }}>
                  {c.Component_Name}
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>{result.fee.schedule ? 'Fee periods' : 'Fee_Rate'}</th>
              {periods.map((p) => (
                <th key={p.label} style={{ textAlign: 'right' }}>
                  Fee_{p.label.replace(/\s+/g, '_')}
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>Fee_Gross</th>
              <th style={{ textAlign: 'right' }}>Fee_Offset</th>
              <th style={{ textAlign: 'right' }}>Fee_Net</th>
              <th style={{ textAlign: 'right' }}>Total_Call</th>
              {eq && <th style={{ textAlign: 'right' }}>Eq_Capital</th>}
              {eq && <th style={{ textAlign: 'right' }}>Eq_Interest</th>}
              {eq && <th style={{ textAlign: 'right' }}>Eq_Catch_Up_Fee</th>}
              {eq && <th style={{ textAlign: 'right' }}>Eq_Fee_Interest</th>}
              {eq && <th style={{ textAlign: 'right' }}>Equalization</th>}
              {eq && <th style={{ textAlign: 'right' }}>Amount_Due</th>}
              <th style={{ textAlign: 'right' }}>Reduces_Unfunded</th>
              {eq && <th style={{ textAlign: 'right' }}>Eq_Reduces_Unfunded</th>}
              <th style={{ textAlign: 'right' }}>Closing_UCC</th>
              <th style={{ textAlign: 'right' }}>Closing_Paid_In</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.LP_ID} style={{ opacity: row.isActive ? 1 : 0.45 }}>
                <td className="mono">{row.LP_ID}</td>
                <td>{row.LP_Name}</td>
                <td className="num">{fmt(Number(row.Commitment))}</td>
                <td className="num">{fmt(row.openUCC)}</td>
                <td className="num">{fmt(row.openPaid)}</td>
                {components.map((c) => {
                  const cell = row.comps.find((x) => x.id === c.Component_ID);
                  return (
                    <td key={c.Component_ID} className="num">
                      {cell?.excused ? (
                        <span className="text-muted">excused</span>
                      ) : (
                        fmt(cell?.amt ?? 0)
                      )}
                    </td>
                  );
                })}
                <td className="num">{result.fee.schedule ? scheduleLabel(result.fee.schedule) : pct(row.feeRate)}</td>
                {periods.map((p, i) => (
                  <td key={p.label} className="num">
                    {fmt(row.feeByPeriod?.[i] ?? 0)}
                  </td>
                ))}
                <td className="num">{fmt(row.feeGross)}</td>
                <td className="num">{fmt(row.feeOffset)}</td>
                <td className="num">{fmt(row.feeNet)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(row.total)}</td>
                {eq && <EqParts parts={equalizationPartsOf(call.model.equalizationSchedule, row.LP_ID, result.d)} />}
                {eq && <td className="num">{row.equalization ? fmt(row.equalization) : '—'}</td>}
                {eq && <td className="num" style={{ fontWeight: 600 }}>{fmt(amountDue(row, result.d))}</td>}
                <td className="num">{fmt(row.reduces)}</td>
                {eq && <td className="num">{row.eqReduces ? fmt(row.eqReduces) : '—'}</td>}
                <td className="num">{fmt(row.closingUCC)}</td>
                <td className="num">{fmt(row.closingPaid)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600, borderTop: '1px solid var(--foreground)' }}>
              <td colSpan={2}>TOTAL</td>
              <td className="num">{fmt(result.totals.Commitment)}</td>
              <td className="num">{fmt(result.totals.openUCC)}</td>
              <td className="num">{fmt(result.totals.openPaid)}</td>
              {components.map((c, i) => (
                <td key={c.Component_ID} className="num">
                  {fmt(result.totals.comps[i] ?? 0)}
                </td>
              ))}
              <td />
              {periods.map((p) => (
                <td key={p.label} className="num">
                  {fmt(p.total)}
                </td>
              ))}
              <td className="num">{fmt(result.totals.feeGross)}</td>
              <td className="num">{fmt(result.totals.feeOffset)}</td>
              <td className="num">{fmt(result.totals.feeNet)}</td>
              <td className="num">{fmt(result.totals.total)}</td>
              {eq && (
                <EqParts
                  parts={{
                    capital: eq.closings.reduce((t, c) => t + c.capital, 0),
                    interest: eq.closings.reduce((t, c) => t + c.interest, 0),
                    catchUpFee: eq.closings.reduce((t, c) => t + c.catchUpFee, 0),
                    feeInterest: eq.closings.reduce((t, c) => t + c.feeInterest, 0),
                  }}
                />
              )}
              {eq && <td className="num">{fmt(eq.total)}</td>}
              {eq && <td className="num">{fmt(round(result.totals.total + eq.total, result.d))}</td>}
              <td className="num">{fmt(result.totals.reduces)}</td>
              {eq && <td className="num">{result.totals.eqReduces ? fmt(result.totals.eqReduces) : '—'}</td>}
              <td className="num">{fmt(result.totals.closingUCC)}</td>
              <td className="num">{fmt(result.totals.closingPaid)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** An investor's equalization on the call, taken apart: capital, late interest, catch-up fee, interest on it. */
function EqParts({ parts }: { parts: { capital: number; interest: number; catchUpFee: number; feeInterest: number } }) {
  const cell = (x: number) => <td className="num">{Math.abs(x) >= 0.005 ? fmt(x) : '—'}</td>;
  return (
    <>
      {cell(parts.capital)}
      {cell(parts.interest)}
      {cell(parts.catchUpFee)}
      {cell(parts.feeInterest)}
    </>
  );
}

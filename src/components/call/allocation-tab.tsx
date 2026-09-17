'use client';

import { useState } from 'react';
import { fmt, pct, type ComputeResult } from '@/engine';
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
              <th style={{ textAlign: 'right' }}>Fee_Rate</th>
              <th style={{ textAlign: 'right' }}>Fee_Gross</th>
              <th style={{ textAlign: 'right' }}>Fee_Offset</th>
              <th style={{ textAlign: 'right' }}>Fee_Net</th>
              <th style={{ textAlign: 'right' }}>Total_Call</th>
              <th style={{ textAlign: 'right' }}>Reduces_Unfunded</th>
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
                <td className="num">{pct(row.feeRate)}</td>
                <td className="num">{fmt(row.feeGross)}</td>
                <td className="num">{fmt(row.feeOffset)}</td>
                <td className="num">{fmt(row.feeNet)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmt(row.total)}</td>
                <td className="num">{fmt(row.reduces)}</td>
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
              <td className="num">{fmt(result.totals.feeGross)}</td>
              <td className="num">{fmt(result.totals.feeOffset)}</td>
              <td className="num">{fmt(result.totals.feeNet)}</td>
              <td className="num">{fmt(result.totals.total)}</td>
              <td className="num">{fmt(result.totals.reduces)}</td>
              <td className="num">{fmt(result.totals.closingUCC)}</td>
              <td className="num">{fmt(result.totals.closingPaid)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@/adapters/workbook/template-layout';

/** A row is an open bag of spreadsheet cells, keyed by the workbook's column names. */
export type EditableRow = Record<string, unknown>;

interface EditableTableProps<T extends EditableRow> {
  columns: ColumnDef[];
  rows: T[];
  onChange: (rows: T[]) => void;
  /** Builds a blank row for the "+ Add" button. */
  newRow: () => T;
  /** Label for that button, e.g. "+ Add investor". */
  addLabel: string;
  /** Issued calls are read-only: inputs are frozen once a notice has gone out. */
  readOnly?: boolean;
  /** An extra leading column, used for the transfers applied/not-applied tag. */
  leading?: (row: T, index: number) => ReactNode;
  leadingHeader?: string;
}

/**
 * A wide, spreadsheet-like table of call inputs.
 *
 * Values are held as typed, never coerced on the way in. An accountant midway
 * through typing "1,0" should see "1,0", not 10 — and an allocation basis of
 * "Vibes" should stay wrong and visible so the Checks tab can say so, rather
 * than being quietly corrected to something plausible.
 */
export function EditableTable<T extends EditableRow>({
  columns,
  rows,
  onChange,
  newRow,
  addLabel,
  readOnly,
  leading,
  leadingHeader,
}: EditableTableProps<T>) {
  function setCell(rowIndex: number, key: string, value: string) {
    onChange(rows.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r)));
  }

  function removeRow(rowIndex: number) {
    onChange(rows.filter((_, i) => i !== rowIndex));
  }

  return (
    <>
      {/* max-content lets the table exceed the card and scroll, rather than
          squeezing thirteen columns into the available width. */}
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              {leading && <th>{leadingHeader}</th>}
              {columns.map((c) => (
                <th key={c.key} style={{ minWidth: c.w, textAlign: c.num ? 'right' : 'left' }}>
                  {c.key}
                </th>
              ))}
              {!readOnly && <th style={{ width: 32 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {leading && <td style={{ whiteSpace: 'nowrap' }}>{leading(row, i)}</td>}
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: '2px 6px' }}>
                    <input
                      className="cell"
                      style={{ textAlign: c.num ? 'right' : 'left' }}
                      value={cellText(row[c.key])}
                      list={c.list}
                      readOnly={readOnly}
                      aria-label={`${c.key}, row ${i + 1}`}
                      onChange={(e) => setCell(i, c.key, e.target.value)}
                    />
                  </td>
                ))}
                {!readOnly && (
                  <td style={{ padding: '2px 6px' }}>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      title="Remove this row"
                      aria-label={`Remove row ${i + 1}`}
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: 'var(--destructive)',
                        cursor: 'pointer',
                        fontSize: 14,
                        lineHeight: 1,
                        padding: 4,
                      }}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (leading ? 1 : 0) + (readOnly ? 0 : 1)}
                  className="text-muted"
                  style={{ padding: '14px 16px' }}
                >
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div style={{ padding: '10px 16px 14px' }}>
          <button type="button" className="btn btn-ghost" onClick={() => onChange([...rows, newRow()])}>
            {addLabel}
          </button>
        </div>
      )}
    </>
  );
}

/** Blank and null render as an empty cell, not "null" or "undefined". */
function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

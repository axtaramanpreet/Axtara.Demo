'use client';

import type { FieldDef } from '@/adapters/workbook/template-layout';

/**
 * The Field / Value / Notes table used by the Fund setup and Management fee
 * steps.
 *
 * The Notes column is the accountant's documentation, kept beside the input
 * rather than behind a tooltip — "0.02 = 2%" is the kind of thing worth reading
 * at the moment you type the number.
 */
export function FieldTable({
  fields,
  values,
  onChange,
  readOnly,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 260 }}>Field</th>
          <th style={{ width: 240 }}>Value</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.key}>
            <td className="mono">{f.key}</td>
            <td style={{ padding: '2px 6px' }}>
              <input
                className="cell"
                type={f.type === 'date' ? 'date' : 'text'}
                style={{ textAlign: f.num ? 'right' : 'left' }}
                value={values[f.key] === null || values[f.key] === undefined ? '' : String(values[f.key])}
                list={f.list}
                readOnly={readOnly}
                aria-label={f.key}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            </td>
            <td className="text-muted">{f.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

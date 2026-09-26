'use client';

import Link from 'next/link';
import type { FieldDef } from '@/adapters/workbook/template-layout';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { CURRENCIES } from '@/lib/currencies';

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
  investors = [],
  locked = new Set<string>(),
  settingsHref,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
  readOnly?: boolean;
  /** This call's investors, for a field picked from them (the rounding plug). */
  investors?: ComboOption[];
  /** Fields that come from the fund's terms: shown, not edited here. */
  locked?: Set<string>;
  /** Where those are changed. */
  settingsHref?: string;
}) {
  const fixed = (f: FieldDef) => locked.has(f.key) || Boolean(f.auto);
  // The call's own fields first: they are the ones to fill in. What the fund
  // decides follows, together, so it reads as settled rather than as more to do.
  const own = fields.filter((f) => !fixed(f));
  const given = fields.filter(fixed);
  const text = (f: FieldDef) => (values[f.key] === null || values[f.key] === undefined ? '' : String(values[f.key]));

  const row = (f: FieldDef) => (
    <tr key={f.key}>
      <td>
        <div>{f.label}</div>
        <div className="mono text-muted" style={{ fontSize: 11 }}>
          {f.key}
        </div>
      </td>
      <td style={{ padding: '2px 6px' }}>
        {fixed(f) ? (
          <input className="cell" readOnly aria-label={f.key} style={{ textAlign: f.num ? 'right' : 'left' }} value={text(f)} />
        ) : f.pick && !readOnly ? (
          <Combobox
            label={f.key}
            options={f.pick === 'currency' ? CURRENCIES : investors}
            value={values[f.key] ? String(values[f.key]) : null}
            onChange={(v) => onChange(f.key, v ?? '')}
            placeholder={
              f.pick === 'currency' ? 'Search, e.g. USD or dollar' : investors.length ? 'Pick an investor' : 'No investors yet — add them on Investors'
            }
            empty={f.pick === 'currency' ? 'No currency matches' : 'No investor matches'}
          />
        ) : (
          <input
            className="cell"
            type={f.type === 'date' ? 'date' : 'text'}
            style={{ textAlign: f.num ? 'right' : 'left' }}
            value={text(f)}
            list={f.list}
            readOnly={readOnly}
            aria-label={f.key}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        )}
      </td>
      <td className="text-muted">
        {f.auto ? (
          f.auto
        ) : locked.has(f.key) ? (
          <>
            <em>From fund terms</em>
            {settingsHref && (
              <>
                {' · '}
                <Link href={settingsHref}>change</Link>
              </>
            )}
          </>
        ) : (
          f.note
        )}
      </td>
    </tr>
  );

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
        {own.map(row)}
        {own.length > 0 && given.length > 0 && (
          <tr>
            <td colSpan={3} className="text-muted" style={{ fontSize: 12, fontWeight: 600, paddingTop: 14 }}>
              Set by the fund — {locked.size ? 'from Fund terms, ' : ''}not typed here
            </td>
          </tr>
        )}
        {given.map(row)}
      </tbody>
    </table>
  );
}

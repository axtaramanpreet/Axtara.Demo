'use client';

import { useRef, useState } from 'react';
import type { CallModel } from '@/engine/types';
import { newModelFromTemplate } from '@/engine/fixtures/illustrative-fund';
import { Button } from '@/components/ui/button';

/**
 * Where a call's inputs come from.
 *
 * Four routes, in the order an accountant is likely to want them: their own
 * workbook, typing it in, carrying the register forward from the last call, or
 * the illustrative template for a look around.
 */
export function SourceStep({
  onWorkbook,
  onManual,
  onCarryForward,
  onTemplate,
  carryForwardFrom,
  readOnly,
}: {
  onWorkbook: (file: File) => void;
  onManual: () => void;
  onCarryForward: () => void;
  onTemplate: (model: CallModel) => void;
  /** Call number to carry the register forward from, if there is one. */
  carryForwardFrom?: number;
  readOnly?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(files: FileList | null) {
    const file = files?.[0];
    if (file) onWorkbook(file);
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <h2>Where do the inputs come from?</h2>

      <div
        className="drop"
        style={{ marginTop: 18, borderColor: dragging ? 'var(--foreground)' : undefined }}
        onClick={() => !readOnly && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!readOnly) take(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click();
        }}
      >
        <div style={{ fontWeight: 500 }}>Drop the input workbook (.xlsx)</div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          or click to browse · tabs Fund_Setup, LP_Register, Call_Components, Management_Fee,
          Transfers
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        style={{ display: 'none' }}
        onChange={(e) => {
          take(e.target.files);
          // Reset so re-selecting the same file fires change again.
          e.target.value = '';
        }}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 20 }}>
        <Button variant="secondary" onClick={onManual} disabled={readOnly}>
          Enter inputs manually
        </Button>

        {carryForwardFrom !== undefined && (
          <button
            type="button"
            onClick={onCarryForward}
            disabled={readOnly}
            style={linkStyle}
            title="Closing paid-in and unfunded become this call's opening balances"
          >
            Carry forward the register from Call No. {carryForwardFrom}
          </button>
        )}
      </div>

      <p style={{ marginTop: 18 }}>
        <button
          type="button"
          onClick={() => onTemplate(newModelFromTemplate())}
          disabled={readOnly}
          className="text-muted"
          style={{ ...linkStyle, fontSize: 13 }}
        >
          Load illustrative template data
        </button>
      </p>
    </div>
  );
}

const linkStyle = {
  border: 0,
  background: 'transparent',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--foreground)',
  textDecoration: 'underline',
  textDecorationColor: 'var(--chart-3)',
  cursor: 'pointer',
  padding: 0,
} as const;

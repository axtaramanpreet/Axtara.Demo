'use client';

import { useRef, useState } from 'react';
import type { CallModel } from '@/engine/types';
import { newModelFromTemplate } from '@/engine/fixtures/illustrative-fund';
import { Button } from '@/components/ui/button';

/**
 * Where a call's inputs come from.
 *
 * Four routes, in the order an accountant is likely to want them: their own
 * workbook, typing it in, the register from the fund — or, for a fund with no
 * closings, carried forward from the last call — or the illustrative template
 * for a look around.
 *
 * Once a fund has closings only the fund's register is offered: carrying
 * forward from the last call would miss anyone a later close admitted.
 */
export function SourceStep({
  onWorkbook,
  onManual,
  onCarryForward,
  onFundRegister,
  onDownloadTemplate,
  onTemplate,
  carryForwardFrom,
  readOnly,
}: {
  onWorkbook: (file: File) => void;
  onManual: () => void;
  onCarryForward: () => void;
  /** Read the register from the fund's closings and calls. Given only once the fund has closings. */
  onFundRegister?: () => void;
  /** Download the input workbook, pre-filled with what the call already knows. */
  onDownloadTemplate: () => void;
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

      <p style={{ marginTop: 10, fontSize: 13 }}>
        <button type="button" onClick={onDownloadTemplate} style={linkStyle}>
          Download the input template
        </button>{' '}
        <span className="text-muted">— with the fund&rsquo;s investors and terms already filled in.</span>
      </p>

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

        {onFundRegister ? (
          <Button variant="primary" onClick={onFundRegister} disabled={readOnly} title="Every investor with a commitment, and what each has paid in, after every closing and issued call">
            Start from the fund&rsquo;s investors
          </Button>
        ) : carryForwardFrom !== undefined && (
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

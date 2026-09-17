'use client';

import { useEffect, useState } from 'react';

/**
 * The stepped progress overlay shown while a workbook is read or a call is
 * allocated.
 *
 * The steps are real stages of work, named in the accountant's vocabulary, so
 * that if something fails the last completed line says where. It is paced
 * rather than instantaneous because the operations it covers genuinely take a
 * moment, and a figure that appears with no explanation invites less scrutiny
 * than one you watched being produced.
 */
export function ProcessingOverlay({
  title,
  steps,
  onDone,
  stepMs = 520,
}: {
  title: string;
  steps: string[];
  /** Called once the last step finishes. */
  onDone?: () => void;
  stepMs?: number;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (active >= steps.length) {
      onDone?.();
      return;
    }
    const timer = setTimeout(() => setActive((n) => n + 1), stepMs);
    return () => clearTimeout(timer);
  }, [active, steps.length, stepMs, onDone]);

  const pct = Math.round((Math.min(active, steps.length) / steps.length) * 100);

  return (
    <div
      data-noprint="1"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'var(--background)', opacity: 0.75 }} />
      <div
        className="card"
        style={{ position: 'relative', width: 440, maxWidth: 'calc(100vw - 40px)', padding: '24px 26px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="spin" />
          <h3>{title}</h3>
        </div>

        <div
          style={{
            height: 3,
            background: 'var(--muted)',
            margin: '18px 0 20px',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: 'var(--foreground)',
              transition: 'width .45s ease',
              width: `${pct}%`,
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: 11 }}>
          {steps.map((label, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : '';
            return (
              <div key={label} className={['pstep', state].filter(Boolean).join(' ')}>
                <i />
                <span>{label}</span>
                <small>{i < active ? 'done' : i === active ? 'working…' : ''}</small>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const UPLOAD_STEPS = (fileName: string) => ({
  title: `Reading ${fileName}`,
  steps: [
    'Opening workbook',
    'Extracting Fund_Setup',
    'Extracting LP_Register',
    'Extracting Call_Components and Management_Fee',
    'Reading Transfers and Expected_Output',
    'Mapping fields to the engine',
  ],
});

export const REVIEW_STEPS = (callNo: number | string) => ({
  title: `Preparing Capital Call No. ${callNo}`,
  steps: [
    'Applying transfers',
    'Allocating components pro-rata',
    'Computing management fee and offsets',
    'Running tie-out checks',
    'Drafting investor notices',
  ],
});

'use client';

import type { CallSources, InputSource } from '@/adapters/storage/types';

export type StepId = 'source' | 'setup' | 'lps' | 'components' | 'fee' | 'transfers';

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'setup', label: 'Fund setup' },
  { id: 'lps', label: 'LP register' },
  { id: 'components', label: 'Call components' },
  { id: 'fee', label: 'Management fee' },
  { id: 'transfers', label: 'Transfers' },
];

/** How each provenance reads in the stepper's detail line. */
const SOURCE_LABEL: Record<InputSource, string> = {
  excel: 'From Excel',
  manual: 'Manual',
  template: 'Template',
  carried: 'Carried forward',
  empty: 'Empty',
};

/**
 * The left rail of the setup screen.
 *
 * Each step carries a one-line summary of what is in it and where it came from,
 * so the accountant can see at a glance that the register came from their
 * workbook but the components were typed by hand — which is exactly the sort of
 * thing that is worth noticing before issuing a call.
 */
export function Stepper({
  current,
  onSelect,
  sources,
  details,
}: {
  current: StepId;
  onSelect: (step: StepId) => void;
  sources: CallSources;
  /** Per-step summary, e.g. "6 investors" or "5 items · USD 6,850,000". */
  details: Partial<Record<StepId, string>>;
}) {
  return (
    <nav
      aria-label="Set up steps"
      style={{ width: 240, flex: 'none', position: 'sticky', top: 24, alignSelf: 'flex-start' }}
    >
      {STEPS.map((step, i) => {
        const source = step.id === 'source' ? undefined : sources[step.id as keyof CallSources];
        const done = source !== undefined && source !== 'empty';
        const detail = [source ? SOURCE_LABEL[source] : null, details[step.id]]
          .filter(Boolean)
          .join(' · ');

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            className={['step', current === step.id ? 'on' : '', done ? 'done' : '']
              .filter(Boolean)
              .join(' ')}
            aria-current={current === step.id ? 'step' : undefined}
            style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', font: 'inherit' }}
          >
            <i>{done ? '✓' : i + 1}</i>
            <span>
              {step.label}
              {detail && <small>{detail}</small>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

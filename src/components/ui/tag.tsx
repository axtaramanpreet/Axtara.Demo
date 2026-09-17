import type { ReactNode } from 'react';
import type { CallStage } from '@/adapters/storage/types';

/** Dot colours, by meaning rather than by colour name. */
export type TagTone =
  /** Grey. Nothing happening yet. */
  | 'neutral'
  /** Blue. Done, settled. */
  | 'accent'
  /** Red. Needs attention before anything can proceed. */
  | 'danger'
  /** Amber. In flight. */
  | 'warn';

const TONE_CLASS: Record<TagTone, string> = {
  neutral: '',
  accent: 'tag-accent',
  danger: 'tag-accent-2',
  warn: 'tag-warn',
};

/**
 * A coloured dot and a label.
 *
 * The label always states the meaning in words. Colour is a second channel, not
 * the only one — these tags carry whether investors have been told they owe
 * money, which nobody should have to distinguish by hue.
 */
export function Tag({ tone = 'neutral', children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={['tag', TONE_CLASS[tone]].filter(Boolean).join(' ')}>{children}</span>;
}

/** How each call stage is worded and coloured. One definition, used everywhere. */
export const STAGE_DISPLAY: Record<CallStage, { label: string; tone: TagTone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'warn' },
  partially_sent: { label: 'Partially sent', tone: 'warn' },
  issued: { label: 'Issued', tone: 'accent' },
};

export function StageTag({ stage }: { stage: CallStage }) {
  const { label, tone } = STAGE_DISPLAY[stage];
  return <Tag tone={tone}>{label}</Tag>;
}

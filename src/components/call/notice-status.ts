import type { NoticeState, NoticeStatus } from '@/adapters/storage/types';
import type { TagTone } from '@/components/ui/tag';

/** How each workflow state reads, and the dot it carries. */
export const NOTICE_DISPLAY: Record<NoticeStatus, { label: string; tone: TagTone }> = {
  draft: { label: 'Draft', tone: 'warn' },
  approved: { label: 'Approved', tone: 'accent' },
  sent: { label: 'Sent', tone: 'neutral' },
};

/**
 * An investor with no notice row yet is a draft.
 *
 * Notices are created by the server when a call is first approved, so before
 * that the register is ahead of the workflow. Treating the absence as a draft
 * keeps the two in step without writing rows the accountant did not ask for.
 */
export function noticeStatusFor(notices: NoticeState[], lpId: string): NoticeStatus {
  return notices.find((n) => n.lpId === lpId)?.status ?? 'draft';
}

export function noticeFor(notices: NoticeState[], lpId: string): NoticeState | undefined {
  return notices.find((n) => n.lpId === lpId);
}

/** Colour of an investor's share-of-call bar, by where their notice has got to. */
export const BAR_COLOUR: Record<NoticeStatus, string> = {
  draft: 'var(--chart-1)',
  approved: 'var(--chart-2)',
  sent: 'var(--chart-3)',
};

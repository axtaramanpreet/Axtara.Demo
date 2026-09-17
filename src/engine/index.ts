/**
 * Capital call engine — public API.
 *
 * Pure calculation with no dependencies, no I/O and no framework. It runs
 * unchanged in a React client component, in a Next.js route handler and in
 * `node --test`, which is what makes the Expected_Output regression test
 * meaningful: the tested code is the shipped code.
 */

export { compute } from './compute';
export { allocate, type AllocationPart } from './allocate';
export { applyTransfers } from './transfers';
export { buildNotice } from './notice';
export type { NoticeData, NoticeLine, NoticeAccountLine, NoticeFootnote } from './notice';
export { fmt, fmtDate, ids, num, pct, round, serialToISO, yes } from './format';
export type * from './types';

/**
 * Timestamps on screen.
 *
 * These have to read the same in every office and be the same string on the
 * server as in the browser. Vercel runs in UTC; nobody else does.
 */

import { describe, expect, it } from 'vitest';
import { fmtDate, fmtStamp } from '../format';

describe('a timestamp shown to a person', () => {
  it('does not move with the reader’s timezone', () => {
    // 22:30 UTC on the 19th is already the 20th in Asia, and still the 19th in
    // California. Left to the viewer, the same notice carries two dates.
    expect(fmtStamp('2026-09-19T22:30:00Z')).toBe('19/09/2026, 22:30 UTC');
    expect(fmtStamp('2026-09-20T01:13:24Z')).toBe('20/09/2026, 01:13 UTC');
  });

  it('says which zone it is in, so the hour is not a guess', () => {
    expect(fmtStamp('2026-09-20T01:13:24Z')).toContain('UTC');
  });

  it('is blank rather than "Invalid Date" when there is nothing to show', () => {
    expect(fmtStamp(null)).toBe('');
    expect(fmtStamp(undefined)).toBe('');
    expect(fmtStamp('')).toBe('');
  });

  it('hands back what it was given rather than inventing a date', () => {
    expect(fmtStamp('not a date')).toBe('not a date');
  });
});

describe('a date shown to a person', () => {
  it('is still pinned the same way', () => {
    // The payment due date must not read a day early in one office.
    expect(fmtDate('2026-09-30')).toBe('30 September 2026');
    expect(fmtDate('2026-01-01')).toBe('1 January 2026');
  });
});

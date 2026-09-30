/** Working days, for the date a statement is suggested to be payable by. */

import { describe, expect, it } from 'vitest';
import { addBusinessDays } from '../dates';
import { suggestedStatementDueDate } from '../equalization-billing';

describe('working days after a date', () => {
  it('skips Saturdays and Sundays', () => {
    // Friday 31 Jul 2026 + 1 working day = Monday 3 Aug
    expect(addBusinessDays('2026-07-31', 1)).toBe('2026-08-03');
    // Monday 3 Aug + 5 = Monday 10 Aug
    expect(addBusinessDays('2026-08-03', 5)).toBe('2026-08-10');
  });

  it('counts from a weekend day to the working days after it', () => {
    // Saturday 1 Aug + 10 = Friday 14 Aug
    expect(addBusinessDays('2026-08-01', 10)).toBe('2026-08-14');
  });

  it('crosses a month and a year end', () => {
    // Thursday 24 Dec 2026 + 10 = Thursday 7 Jan 2027 (25 Dec and 1 Jan are weekdays: no holidays known)
    expect(addBusinessDays('2026-12-24', 10)).toBe('2027-01-07');
  });

  it('is the date itself for none', () => {
    expect(addBusinessDays('2026-08-01', 0)).toBe('2026-08-01');
  });
});

describe('a statement’s suggested payment date', () => {
  it('is ten working days after the closing', () => {
    expect(suggestedStatementDueDate('2026-05-02')).toBe('2026-05-15');
  });
});

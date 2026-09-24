/**
 * The sidebar tile.
 *
 * The two the handoff states by name are pinned first; the rest are the cases
 * that decide whether the rule is "keep the numeral" or "take some initials".
 */

import { describe, expect, it } from 'vitest';
import { fundCode } from '../fund-code';

describe('the code a fund is shown by', () => {
  it('is the two the handoff spells out', () => {
    expect(fundCode('Illustrative Fund II, L.P.')).toBe('II');
    expect(fundCode('Alpha Growth Partners')).toBe('AG');
  });

  it('keeps the numeral, because that is what tells two funds apart', () => {
    // These three sit in one client's list and differ only here.
    expect(fundCode('Illustrative Fund II, L.P.')).toBe('II');
    expect(fundCode('Illustrative Fund III, L.P.')).toBe('III');
    expect(fundCode('Illustrative Fund IV, L.P.')).toBe('IV');
  });

  it('puts a distinguishing initial in front of the numeral when there is one', () => {
    expect(fundCode('Meridian Growth Partners III')).toBe('MIII');
    expect(fundCode('Thornfield Continuation Fund II')).toBe('TII');
  });

  it('reads an arabic numeral too', () => {
    expect(fundCode('Harbour Fund 2, L.P.')).toBe('H2');
  });

  it('drops the legal suffix rather than coding it', () => {
    for (const suffix of ['L.P.', 'LP', 'LLC', 'Ltd', 'Limited', 'Inc.']) {
      expect(fundCode(`Alpha Growth Partners, ${suffix}`), suffix).toBe('AG');
    }
  });

  it('never exceeds four characters', () => {
    expect(fundCode('Northbridge Special Opportunities XXXIII').length).toBeLessThanOrEqual(4);
  });

  it('says something rather than nothing for a name it cannot read', () => {
    expect(fundCode('')).toBe('?');
    expect(fundCode('Fund')).toBe('FU');
  });

  it('is always upper case, so the tiles read as one set', () => {
    expect(fundCode('alpha growth partners')).toBe('AG');
    expect(fundCode('illustrative fund ii')).toBe('II');
  });
});

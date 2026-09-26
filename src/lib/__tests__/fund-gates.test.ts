import { describe, expect, it } from 'vitest';
import { fundGates, nextStep } from '../fund-gates';

const blank = { hasTerms: false, investors: 0, closings: 0, finalisedClosings: 0, calls: 0 };

describe('what a fund may do next', () => {
  it('offers only the terms to a brand-new fund', () => {
    const g = fundGates(blank);
    expect(g.closings).toMatch(/terms first/);
    expect(g.calls).toMatch(/terms first/);
    expect(g.fees).toMatch(/terms first/);
  });

  it('opens closings once there are terms, and calls and fees once the first close is finalised', () => {
    expect(fundGates({ ...blank, hasTerms: true })).toMatchObject({ closings: null, calls: expect.stringMatching(/first close/) });
    expect(fundGates({ ...blank, hasTerms: true, closings: 1 }).calls).toMatch(/Finalise the first close/);
    expect(fundGates({ ...blank, hasTerms: true, closings: 1, finalisedClosings: 1 })).toEqual({ closings: null, calls: null, fees: null });
  });

  it('keeps a fund that was already calling working, terms or not', () => {
    expect(fundGates({ ...blank, calls: 3 })).toEqual({ closings: null, calls: null, fees: null });
  });
});

describe('the next step, once a setup step is done', () => {
  it('points from each finished step to the one after it', () => {
    expect(nextStep({ ...blank, hasTerms: true }, 'settings')?.path).toBe('investors');
    expect(nextStep({ ...blank, hasTerms: true, investors: 3 }, 'investors')?.path).toBe('closings');
    expect(nextStep({ ...blank, hasTerms: true, investors: 3, closings: 1, finalisedClosings: 1 }, 'closings')?.path).toBe('');
  });

  it('says nothing before the step is done, or once the fund is running', () => {
    expect(nextStep(blank, 'settings')).toBeNull();
    expect(nextStep({ ...blank, hasTerms: true, investors: 3, closings: 1 }, 'closings')).toBeNull();
    expect(nextStep({ ...blank, hasTerms: true, calls: 1 }, 'settings')).toBeNull();
  });
});

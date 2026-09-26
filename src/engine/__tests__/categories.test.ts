import { describe, expect, it } from 'vitest';
import { categoryOf, isDeal } from '../categories';
import { compute } from '../compute';
import { ILLUSTRATIVE_FUND } from '../fixtures/illustrative-fund';

describe('what a call component is', () => {
  it('reads the three kinds however they are written', () => {
    expect(['Deal', ' deals ', 'Investment', 'DEAL'].map(categoryOf)).toEqual(['Deal', 'Deal', 'Deal', 'Deal']);
    expect(categoryOf('Fund expenses')).toBe('Partnership Expense');
    expect(categoryOf('Organisational  Expense')).toBe('Organizational Expense');
  });

  it('does not guess at anything else — a broken deal cost is not an investment', () => {
    expect(categoryOf('Broken deal costs')).toBeNull();
    expect(isDeal('Broken deal costs')).toBe(false);
    expect(categoryOf('Management fee')).toBeNull();
  });

  it('stops a call whose component is none of them, naming it', () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.components[0] = { ...model.components[0], Category: 'Dael' };
    const fail = compute(model).checks.filter((c) => c.level === 'fail');
    expect(fail.map((c) => c.text)).toEqual(['C1 has category "Dael". Pick one of: Deal, Partnership Expense, Organizational Expense.']);
  });

  it('allows a call that is only the management fee', () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.components = [];
    const r = compute(model);
    expect(r.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(r.totals.total).toBe(r.totals.feeNet);
    expect(r.totals.total).toBeGreaterThan(0);
  });
});

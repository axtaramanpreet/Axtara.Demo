/**
 * What a call component is, which decides what the engine does with it.
 *
 * Three kinds, and only three: an investment becomes invested capital, an
 * organizational expense is checked against the fund's cap, and a partnership
 * expense is a running cost of the fund. The management fee is never a
 * component — it is worked out in its own step — so it has no category here.
 *
 * `categoryOf` reads what a workbook or an older call says: any case, extra
 * spaces, a plural, or a common other name for the same thing. Anything else is
 * not guessed at.
 */

export const CATEGORIES = ['Deal', 'Partnership Expense', 'Organizational Expense'] as const;
export type Category = (typeof CATEGORIES)[number];

const SAME: Record<string, Category> = {
  deal: 'Deal',
  deals: 'Deal',
  investment: 'Deal',
  investments: 'Deal',
  'partnership expense': 'Partnership Expense',
  'partnership expenses': 'Partnership Expense',
  'fund expense': 'Partnership Expense',
  'fund expenses': 'Partnership Expense',
  'organizational expense': 'Organizational Expense',
  'organizational expenses': 'Organizational Expense',
  'organisational expense': 'Organizational Expense',
  'organisational expenses': 'Organizational Expense',
  'org expense': 'Organizational Expense',
  'formation expense': 'Organizational Expense',
  'formation expenses': 'Organizational Expense',
};

/** The category a component's text means, or null when it is none of them. */
export function categoryOf(raw: unknown): Category | null {
  return SAME[String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

/** Money for an investment, and so invested capital. */
export function isDeal(raw: unknown): boolean {
  return categoryOf(raw) === 'Deal';
}

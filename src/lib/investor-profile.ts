/**
 * What an investor's profile needs before the fund can rely on it, and the
 * words the screens use for it.
 *
 * One rule for everywhere that asks — the Investors list, an investor's page,
 * a closing that admits them — so "profile incomplete" means the same thing
 * wherever it is shown.
 */

import type { FundInvestor, KycStatus } from '@/adapters/storage/types';

export const INVESTOR_TYPES = [
  'Pension',
  'Endowment',
  'Foundation',
  'Family office',
  'Sovereign wealth',
  'Insurance',
  'Fund of funds',
  'Corporate',
  'Individual',
  'General partner',
  'Other',
];

export const KYC_LABEL: Record<KycStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  approved: 'Approved',
  expired: 'Expired',
};

/**
 * What is missing from a profile, in words. Empty when complete.
 *
 * Registers written before the Investors page existed carry a type of 'LP' or
 * 'GP', which says nothing about the investor, so it counts as missing.
 */
export function profileGaps(i: Pick<FundInvestor, 'type' | 'email' | 'country'>): string[] {
  const gaps: string[] = [];
  if (!i.type || i.type === 'LP' || i.type === 'GP') gaps.push('investor type');
  if (!i.email) gaps.push('notices email');
  if (!i.country) gaps.push('country');
  return gaps;
}

/**
 * A register's rows with each known investor's identity — name, type, email,
 * side-letter reference, notes — taken from their profile, not from whatever
 * a workbook said. The Investors page owns who an investor is; a call only
 * says what they owe. Returns what the workbook said differently, in words.
 */
export function identityFromProfiles<T extends { LP_ID: string; LP_Name?: unknown; LP_Type?: unknown; Contact_Email?: unknown; Side_Letter_Ref?: unknown; Notes?: unknown }>(
  lps: T[],
  investors: FundInvestor[],
): { lps: T[]; notes: string[] } {
  const profiles = new Map(investors.map((i) => [i.lpId, i]));
  const notes: string[] = [];
  const out = lps.map((l) => {
    const p = profiles.get(String(l.LP_ID ?? '').trim());
    if (!p) return l;
    const typed = String(l.LP_Name ?? '').trim();
    if (typed && typed !== p.name) notes.push(`${p.lpId}: the workbook says “${typed}”; the register says “${p.name}”.`);
    return {
      ...l,
      LP_Name: p.name,
      LP_Type: p.type,
      Contact_Email: p.email ?? '',
      Side_Letter_Ref: p.sideLetterRef ?? '',
      Notes: p.notes ?? '',
    };
  });
  return { lps: out, notes };
}

import { describe, expect, it } from 'vitest';
import { identityFromProfiles, profileGaps } from '../investor-profile';

describe('what an investor profile still needs', () => {
  it('is nothing for a complete one', () => {
    expect(profileGaps({ type: 'Pension', email: 'ops@alpha.example', country: 'Canada' })).toEqual([]);
  });

  it('names each missing piece, and does not take a legacy LP/GP type as a type', () => {
    expect(profileGaps({ type: 'LP', email: null, country: null })).toEqual(['investor type', 'notices email', 'country']);
    expect(profileGaps({ type: 'GP', email: 'gp@fund.example', country: 'USA' })).toEqual(['investor type']);
  });
});

describe('a register’s identity, from the investors’ profiles', () => {
  const profile = {
    id: 'i1', lpId: 'LP01', name: 'Alpha Pension Trust', type: 'Pension', email: 'ops@alpha.example', ccEmails: [],
    country: 'Canada', isGp: false, kycStatus: 'approved' as const, sideLetterRef: 'SL-1', notes: null,
  };

  it('takes a known investor’s identity from their profile, and says what the workbook said', () => {
    const { lps, notes } = identityFromProfiles(
      [
        { LP_ID: 'LP01', LP_Name: 'Alpha Pension', LP_Type: 'LP', Contact_Email: 'old@alpha.example', Commitment: 1 },
        { LP_ID: 'LP09', LP_Name: 'Someone New', Commitment: 2 },
      ],
      [profile],
    );
    expect(lps[0]).toMatchObject({ LP_Name: 'Alpha Pension Trust', LP_Type: 'Pension', Contact_Email: 'ops@alpha.example', Side_Letter_Ref: 'SL-1', Commitment: 1 });
    expect(lps[1]).toMatchObject({ LP_Name: 'Someone New' });
    expect(notes).toEqual(['LP01: the workbook says “Alpha Pension”; the register says “Alpha Pension Trust”.']);
  });
});

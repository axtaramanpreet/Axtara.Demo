// @vitest-environment jsdom

/**
 * A call follows its fund's terms.
 *
 * Fund-level fields come from Settings, in force on the call date: shown and
 * locked where Settings has a value, the call's own where it does not, and
 * never touched on a call that has been issued.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));

const saveCall = vi.fn(async () => {});
vi.mock('@/adapters/storage/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/adapters/storage/supabase-repository', () => ({
  createSupabaseRepository: () => ({ saveCall, deleteCall: vi.fn() }),
}));

import { BLANK_TERMS, emptyCall, equalize, equalizationInputFor, type CallModel, type ClosingRecord, type FundHistory, type FundTerms } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail, FundInvestor } from '@/adapters/storage/types';
import { SetupScreen } from '../setup-screen';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2024-01-01',
  createdAt: '2024-01-02T00:00:00Z',
  reportingCurrency: 'USD',
  feeRateAnnual: 0.0175,
  gpName: 'Illustrative GP LLC',
};

function renderScreen(
  model: CallModel,
  fundTerms: FundTerms[],
  lockedAt: string | null = null,
  record: Omit<FundHistory, 'terms'> = { closings: [], calls: [] },
  lps: 'template' | 'empty' = 'template',
  investors: FundInvestor[] = [],
) {
  const call = {
    id: 'call-1',
    fundId: 'fund-1',
    callNo: 2,
    stage: 'in_progress',
    lockedAt,
    sources: { setup: 'template', lps, components: 'template', fee: 'template', transfers: 'template' },
    sourceFileName: null,
    model,
    notices: [],
  } as unknown as CallDetail;
  return render(<SetupScreen call={call} fundId="fund-1" previousCall={null} fundTerms={fundTerms} record={record} investors={investors} today="2026-09-25" />);
}

const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

afterEach(() => {
  cleanup();
  saveCall.mockClear();
});

describe('a draft call and its fund’s terms', () => {
  it('shows fund-level fields from Settings, locked', () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms]);
    expect(input('GP_Name').value).toBe('Illustrative GP LLC');
    expect(input('GP_Name').readOnly).toBe(true);
    expect(input('Reporting_Currency').readOnly).toBe(true);
    expect(screen.getAllByText('From fund terms').length).toBeGreaterThan(0);
  });

  it('leaves the call’s own fields editable, and none of the fund’s', () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms]);
    expect(input('Call_Date').readOnly).toBe(false);
    // Blank in Fund terms, and so blank and locked here: the fund decides it.
    expect(input('Signatory_Name').readOnly).toBe(true);
    expect(input('Signatory_Name').value).toBe('');
    // Picked per call, never locked.
    expect(screen.getByRole('combobox', { name: 'Rounding_Plug_LP_ID' })).toBeDefined();
  });

  it('replaces a fee that differs, says what it replaced, and saves it only on Save', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms]);
    // The illustrative call charges 2%; Settings says 1.75%.
    expect(screen.getByText(/Updated from the fund's terms in force on 30 September 2026/)).toBeDefined();
    expect(screen.getByText(/Default_Fee_Rate_Annual 0.02 → 0.0175/)).toBeDefined();
    expect(screen.getByText('Unsaved changes')).toBeDefined();
    expect(saveCall).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveCall).toHaveBeenCalledTimes(1);
    const [, saved] = saveCall.mock.calls[0] as unknown as [string, CallModel];
    expect(saved.fee.Default_Fee_Rate_Annual).toBe(0.0175);
    expect(saved.setup.Default_Mgmt_Fee_Rate_Annual).toBe(0.0175);
    expect(saved.setup.GP_Name).toBe('Illustrative GP LLC');
  });

  it('reads the terms in force on the call date, not today', async () => {
    const later: FundTerms = { ...terms, effectiveFrom: '2027-01-01', createdAt: '2024-01-03T00:00:00Z', feeRateAnnual: 0.015 };
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.setup.Call_Date = '2027-03-31';
    renderScreen(model, [terms, later]);
    expect(screen.getByText(/Default_Fee_Rate_Annual 0.02 → 0.015/)).toBeDefined();
  });

  it('follows the call date when it moves', async () => {
    const later: FundTerms = { ...terms, effectiveFrom: '2027-01-01', createdAt: '2024-01-03T00:00:00Z', feeRateAnnual: 0.015 };
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms, later]);
    const date = input('Call_Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2027-03-31');
    expect(screen.getByText(/Default_Fee_Rate_Annual 0.0175 → 0.015/)).toBeDefined();
  });
});

describe('a fund with no terms recorded', () => {
  it('changes nothing, and leaves every field editable', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), []);
    expect(input('GP_Name').readOnly).toBe(false);
    expect(screen.queryByText('From fund terms')).toBeNull();
    expect(screen.getByText(/no terms recorded/)).toBeDefined();
    await new Promise((r) => setTimeout(r, 1000));
    expect(saveCall).not.toHaveBeenCalled();
  });
});

describe('an issued call', () => {
  it('is left exactly as it was sent', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms], '2026-09-30T09:00:00Z');
    expect(screen.queryByText(/Updated from the fund's terms/)).toBeNull();
    expect(input('GP_Name').value).toBe('');
    await new Promise((r) => setTimeout(r, 1000));
    expect(saveCall).not.toHaveBeenCalled();
  });
});

describe('a fund with closings', () => {
  const first: ClosingRecord = {
    id: 'c1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
    commitments: [
      { lpId: 'LP01', name: 'Alpha Pension Trust', amount: 6e6, feeRateOverride: null, feeExempt: false, contactEmail: 'alpha@example.com' },
      { lpId: 'GP01', name: 'Fund GP LLC', amount: 1e6, feeRateOverride: null, feeExempt: true },
    ],
  };
  const blank = () => emptyCall('Meridian Growth Partners III');

  it('offers its own investors, not a carry-forward, and fills the register from the closings', async () => {
    renderScreen(blank(), [terms], null, { closings: [first], calls: [] }, 'empty');
    expect(screen.queryByText(/Carry forward/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start from the fund’s investors' }));
    expect(saveCall).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveCall).toHaveBeenCalledTimes(1);
    const saved = (saveCall.mock.calls.at(-1) as unknown as [string, CallModel])[1];
    expect(saved.lps.map((l) => [l.LP_ID, l.Commitment, l.Opening_UCC, l.Fee_Exempt, l.Contact_Email])).toEqual([
      ['GP01', 1e6, 1e6, 'Y', ''],
      ['LP01', 6e6, 6e6, 'N', 'alpha@example.com'],
    ]);
  });

  it('refuses, and says why, when a call and the closings disagree', async () => {
    const call1 = {
      callNo: 1, callDate: '2026-03-01', dueDate: '2026-03-15',
      lines: [{ lpId: 'LP01', name: 'Alpha', commitment: 5e6, openPaid: 0, openUnfunded: 5e6, openInvested: 0, total: 0, reduces: 0, capital: 0, inside: 0, deal: 0 }],
    };
    renderScreen(blank(), [terms], null, { closings: [first], calls: [call1] }, 'empty');
    await userEvent.click(screen.getByRole('button', { name: 'Start from the fund’s investors' }));
    expect(screen.getByRole('alert').textContent).toContain('Call No. 1 has LP01 committed at 5,000,000.00, but the closings say 6,000,000.00.');
    expect(saveCall).not.toHaveBeenCalled();
  });

  it('lists how a register typed or uploaded differs from the record, and puts the record’s in its place', async () => {
    // The illustrative template's register is not this fund's first close.
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms], null, { closings: [first], calls: [] });
    expect(screen.getByText('Register differs from the fund’s record')).toBeTruthy();
    expect(screen.getByText('LP02 is on this register, but no closing admitted them.')).toBeTruthy();
    expect(screen.getByText(/^LP01 commitment: 10,000,000.00 here, 6,000,000.00 in the fund's record\.$/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Use the fund’s register' }));
    expect(screen.queryByText('Register differs from the fund’s record')).toBeNull();
    expect(saveCall).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = (saveCall.mock.calls.at(-1) as unknown as [string, CallModel])[1];
    expect(saved.lps.map((l) => l.LP_ID)).toEqual(['GP01', 'LP01']);
    // The rest of the call is left as it was.
    expect(saved.components.length).toBe(ILLUSTRATIVE_FUND.components.length);
  });

  it('says nothing while the register is still empty', () => {
    renderScreen(blank(), [terms], null, { closings: [first], calls: [] }, 'empty');
    expect(screen.queryByText('Register differs from the fund’s record')).toBeNull();
  });
});

describe('saving, only when someone chooses to', () => {
  it('keeps an edit on screen and unsaved, and holds back the review until it is saved', async () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    renderScreen(model, []);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    await userEvent.clear(input('Call_Date'));
    await userEvent.type(input('Call_Date'), '2026-10-01');
    // Well past any debounce: nothing may reach the database by itself.
    await new Promise((r) => setTimeout(r, 1200));
    expect(saveCall).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Review allocation ›' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveCall).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Saved')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Review allocation ›' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks before a link leaves unsaved work behind', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), []);
    await userEvent.clear(input('Call_Date'));
    await userEvent.type(input('Call_Date'), '2026-10-01');
    await userEvent.click(screen.getByRole('link', { name: '‹ All calls' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/not saved/));
    confirm.mockRestore();
  });
});

describe('numbering new rows', () => {
  it('gives the next free ID after the highest in use', async () => {
    const { nextSeq } = await import('../setup-screen');
    expect(nextSeq('C', ['C1', 'C7', 'X9', ''])).toBe('C8');
    expect(nextSeq('T', [])).toBe('T1');
  });
});

describe('the management fee, on the call', () => {
  const openStep = async (label: RegExp) => userEvent.click(screen.getByText(label));

  it('shows what each investor is charged, with the working, before review', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), []);
    await openStep(/^Management fee$/);
    const lp03 = screen.getByText('Gamma Family Office', { exact: false }).closest('tr') ?? screen.getAllByText(/LP03/)[0].closest('tr')!;
    // LP03 has a 1% side letter: 5,000,000 × 1% × 0.25 = 12,500 gross
    expect(lp03.textContent).toContain('5,000,000.00');
    expect(lp03.textContent).toContain('× 1.00% × 0.25');
    expect(lp03.textContent).toContain('12,500.00');
    const gp = screen.getAllByText(/GP01/)[0].closest('tr')!;
    expect(gp.textContent).toContain('exempt');
  });

  it('says a call with no components is for the fee alone', () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.components = [];
    renderScreen(model, []);
    expect(screen.getByText(/^Management fee only: USD/)).toBeDefined();
    expect(screen.getByText(/none — fee only/)).toBeDefined();
  });

  it('asks for a category from the list, not typed', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), []);
    await openStep(/^Call components$/);
    const category = screen.getByRole('combobox', { name: 'Category, row 1' }) as HTMLSelectElement;
    expect([...category.options].map((o) => o.value)).toEqual(['', 'Deal', 'Partnership Expense', 'Organizational Expense']);
  });
});

describe('one fee per period', () => {
  const earlier = {
    callNo: 1, callDate: '2026-09-01', dueDate: '2026-09-15',
    lines: [{ lpId: 'LP01', name: 'Alpha', commitment: 10e6, openPaid: 0, openUnfunded: 10e6, openInvested: 0, total: 150_000, reduces: 100_000, capital: 100_000, inside: 100_000, deal: 100_000 }],
  };

  it('warns when an earlier sent call already charged this period’s fee, and leaves it out in one click', async () => {
    // The illustrative call is dated 30 September 2026: Q3, like the earlier call.
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [], null, { closings: [], calls: [earlier] });
    expect(screen.getByText('Fee charged twice')).toBeDefined();
    expect(screen.getByText(/Q3 2026’s management fee was already charged on Call No. 1 \(50,000.00\)/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Leave the fee out of this call' }));
    expect(screen.queryByText('Fee charged twice')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = (saveCall.mock.calls.at(-1) as unknown as [string, CallModel])[1];
    expect(saved.setup.Charge_Mgmt_Fee).toBe('N');
  });

  it('says which period the fee covers', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), []);
    await userEvent.click(screen.getByText(/^Management fee$/));
    expect(screen.getByText(/^Covers Q3 2026 \(1 July 2026 – 30 September 2026\)/)).toBeDefined();
  });
});

describe('the rounding plug, before the register is filled in', () => {
  it('offers the fund’s investors', async () => {
    const investors = [{ id: 'i1', lpId: 'LP04', name: 'Kestrel', type: 'Pension', email: null, ccEmails: [], country: null, isGp: false, kycStatus: 'approved' as const, sideLetterRef: null, notes: null }];
    renderScreen(emptyCall('Fund III'), [], null, { closings: [], calls: [] }, 'template', investors);
    await userEvent.click(screen.getByRole('combobox', { name: 'Rounding_Plug_LP_ID' }));
    expect(screen.getByText('Kestrel')).toBeDefined();
  });
});

describe('fee periods, for a fund with closings', () => {
  const quarterly: FundTerms = { ...BLANK_TERMS, effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', feeBasis: 'Commitment', feeRateAnnual: 0.02, feePeriodFraction: 0.25, feeTiming: 'advance', feeReducesUnfunded: true, catchUpFeeUntil: 'closing_date' };
  const close: ClosingRecord = {
    id: 'c1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
    commitments: [{ lpId: 'LP01', name: 'Alpha', amount: 10e6, feeRateOverride: null, feeExempt: false }],
  };
  const call = () => {
    const m = emptyCall('Fund III');
    m.setup.Call_Date = '2026-08-10';
    m.lps = [{ LP_ID: 'LP01', LP_Name: 'Alpha', LP_Type: 'Pension', Commitment: 10e6, Opening_Paid_In: 0, Opening_UCC: 10e6, Opening_Invested_Capital: 0, Mgmt_Fee_Rate_Override: '', Fee_Exempt: 'N', Status: 'Active' }];
    return m;
  };

  it('starts with the period the call falls in, to check and save', async () => {
    renderScreen(call(), [quarterly], null, { closings: [close], calls: [] });
    expect(screen.getByText(/Fee periods chosen: Q3 2026/)).toBeDefined();
    expect(screen.getByText('Unsaved changes')).toBeDefined();
    await userEvent.click(screen.getByText(/^Management fee$/));
    expect((screen.getByRole('checkbox', { name: 'Bill Q3 2026' }) as HTMLInputElement).checked).toBe(true);
  });

  it('bills several periods at once, a column each, as after a credit line', async () => {
    renderScreen(call(), [quarterly], null, { closings: [close], calls: [] });
    await userEvent.click(screen.getByText(/^Management fee$/));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bill Q1 2026' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bill Q2 2026' }));
    // 10,000,000 × 2% × 0.25 = 50,000 a quarter
    const row = screen.getAllByText(/LP01/).map((e) => e.closest('tr')!).find((tr) => tr.textContent!.includes('150,000.00'))!;
    expect(row.textContent).toContain('50,000.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = (saveCall.mock.calls.at(-1) as unknown as [string, CallModel])[1];
    expect(saved.feeSchedule!.map((e) => [e.label, e.byLp.LP01])).toEqual([
      ['Q1 2026', 50_000],
      ['Q2 2026', 50_000],
      ['Q3 2026', 50_000],
    ]);
  });

  it('flags a schedule another call has since billed, and updates it in one click', async () => {
    const m = call();
    m.feeSchedule = [{ from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026', byLp: { LP01: 50_000 } }];
    const billedQ3 = {
      callNo: 1, callDate: '2026-07-02', dueDate: '', feeSchedule: m.feeSchedule,
      lines: [{ lpId: 'LP01', name: 'Alpha', commitment: 10e6, openPaid: 0, openUnfunded: 10e6, openInvested: 0, total: 50_000, reduces: 50_000, capital: 0, inside: 0, deal: 0 }],
    };
    renderScreen(m, [quarterly], null, { closings: [close], calls: [billedQ3] });
    expect(screen.getByText('Fee out of date')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Update the fee' }));
    expect(screen.queryByText('Fee out of date')).toBeNull();
  });

  it('says so when the call bills a period but has nobody on its register, and fills it in one click', async () => {
    const m = call();
    m.lps = [];
    renderScreen(m, [quarterly], null, { closings: [close], calls: [] });
    await userEvent.click(screen.getByText(/^Management fee$/));
    expect(screen.getByRole('alert').textContent).toContain('no investors on its register yet');
    await userEvent.click(screen.getByRole('button', { name: 'Use the fund’s register' }));
    expect(screen.queryByText('Not on this call')).toBeNull();
    const row = screen.getAllByText(/LP01/).map((e) => e.closest('tr')!).find((tr) => tr.textContent!.includes('Alpha'))!;
    expect(row.textContent).toContain('50,000.00');
  });
});

describe('a later closing settled on the next call', () => {
  const quarterly: FundTerms = { ...BLANK_TERMS, effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', feeBasis: 'Commitment', feeRateAnnual: 0.02, feePeriodFraction: 0.25, feeTiming: 'advance', feeReducesUnfunded: true, catchUpFeeUntil: 'closing_date' };
  const first: ClosingRecord = {
    id: 'c1', closingNo: 1, closingDate: '2026-01-01', finalised: true, result: null,
    commitments: [{ lpId: 'LP01', name: 'Alpha', amount: 10e6, feeRateOverride: null, feeExempt: false }],
  };
  const draft: ClosingRecord = {
    id: 'c2', closingNo: 2, closingDate: '2026-05-01', finalised: false, result: null,
    commitments: [{ lpId: 'LP07', name: 'Eta', amount: 5e6, feeRateOverride: null, feeExempt: false }],
  };
  // LP07 pays the catch-up fee for 1 Jan – 30 Apr, to the manager: 25,000 + 25,000 × 30/91 = 33,241.76
  const result = equalize(equalizationInputFor({ terms: [quarterly], closings: [first, draft], calls: [] }, 'c2')!);
  const second = (settlement: ClosingRecord['settlement']): ClosingRecord => ({ ...draft, finalised: true, result, settlement });
  const call = () => {
    const m = emptyCall('Fund III');
    m.setup.Call_Date = '2026-08-10';
    const lp = (id: string, name: string, c: number) => ({ LP_ID: id, LP_Name: name, LP_Type: 'Pension', Commitment: c, Opening_Paid_In: 0, Opening_UCC: c, Opening_Invested_Capital: 0, Mgmt_Fee_Rate_Override: '', Fee_Exempt: 'N', Status: 'Active' });
    m.lps = [lp('LP01', 'Alpha', 10e6), lp('LP07', 'Eta', 5e6)];
    return m;
  };

  it('carries it: worked out from the closing, each part on its own step, and saved with the call', async () => {
    expect(result.lines.find((l) => l.lpId === 'LP07')!.net).toBe(33_241.76);
    renderScreen(call(), [quarterly], null, { closings: [first, second('next_call')], calls: [] });
    expect(screen.getByText(/Equalization carried from Closing 2: earlier calls on Call components, the catch-up fee on Management fee\./)).toBeDefined();
    // No call came before the close, so no capital moves: Call components says so…
    await userEvent.click(screen.getByText(/^Call components$/));
    expect(screen.getByText(/Closing 2 moves no capital/)).toBeDefined();
    // …and the catch-up fee is with the management fee, marked as the manager's.
    await userEvent.click(screen.getByText(/^Management fee$/));
    const card = screen.getByText('Catch-up fee from later closings').closest('.card') as HTMLElement;
    const row = [...card.querySelectorAll('tr')].find((tr) => tr.textContent!.includes('LP07'))!;
    expect(row.textContent).toContain('pays 33,241.76');
    expect(card.textContent).toContain('33,241.76 goes to the manager');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = (saveCall.mock.calls.at(-1) as unknown as [string, CallModel])[1];
    expect(saved.equalizationSchedule).toEqual([
      { closingId: 'c2', closingNo: 2, closingDate: '2026-05-01', byLp: { LP07: 33_241.76 }, parts: { LP07: { capital: 0, inside: 0, interest: 0, catchUpFee: 33_241.76, feeInterest: 0 } }, interestUntil: '2026-05-01', settles: 'on_call', feeReducesUnfunded: true },
    ]);
  });

  it('carries nothing when it is settled by statement', () => {
    renderScreen(call(), [quarterly], null, { closings: [first, second('on_closing')], calls: [] });
    expect(screen.queryByText(/Equalization carried/)).toBeNull();
    expect(screen.queryByText('Equalization not settled')).toBeNull();
  });

  it('says the call waits while nobody has chosen how to settle it', () => {
    renderScreen(call(), [quarterly], null, { closings: [first, second(null)], calls: [] });
    expect(screen.getByText('Equalization not settled')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Choose on Closings' }).getAttribute('href')).toBe('/funds/fund-1/closings');
  });
});

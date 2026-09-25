// @vitest-environment jsdom

/**
 * A call follows its fund's terms.
 *
 * Fund-level fields come from Settings, in force on the call date: shown and
 * locked where Settings has a value, the call's own where it does not, and
 * never touched on a call that has been issued.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

import { BLANK_TERMS, type CallModel, type FundTerms } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail } from '@/adapters/storage/types';
import { SetupScreen } from '../setup-screen';

const terms: FundTerms = {
  ...BLANK_TERMS,
  effectiveFrom: '2024-01-01',
  createdAt: '2024-01-02T00:00:00Z',
  reportingCurrency: 'USD',
  feeRateAnnual: 0.0175,
  gpName: 'Illustrative GP LLC',
};

function renderScreen(model: CallModel, fundTerms: FundTerms[], lockedAt: string | null = null) {
  const call = {
    id: 'call-1',
    fundId: 'fund-1',
    callNo: 2,
    stage: 'in_progress',
    lockedAt,
    sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
    sourceFileName: null,
    model,
    notices: [],
  } as unknown as CallDetail;
  return render(<SetupScreen call={call} fundId="fund-1" previousCall={null} fundTerms={fundTerms} today="2026-09-25" />);
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
    expect(screen.getAllByText('From Settings').length).toBeGreaterThan(0);
  });

  it('leaves the call’s own fields editable', () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms]);
    expect(input('Call_Date').readOnly).toBe(false);
    // Blank in Settings, so still the call's to type.
    expect(input('Signatory_Name').readOnly).toBe(false);
    // Picked per call, never locked.
    expect(screen.getByRole('combobox', { name: 'Rounding_Plug_LP_ID' })).toBeDefined();
  });

  it('replaces a fee that differs, says what it replaced, and saves it', async () => {
    renderScreen(structuredClone(ILLUSTRATIVE_FUND), [terms]);
    // The illustrative call charges 2%; Settings says 1.75%.
    expect(screen.getByText(/Updated from the fund's terms in force on 30 September 2026/)).toBeDefined();
    expect(screen.getByText(/Default_Fee_Rate_Annual 0.02 → 0.0175/)).toBeDefined();

    await waitFor(() => expect(saveCall).toHaveBeenCalled(), { timeout: 2000 });
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
    expect(screen.queryByText('From Settings')).toBeNull();
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

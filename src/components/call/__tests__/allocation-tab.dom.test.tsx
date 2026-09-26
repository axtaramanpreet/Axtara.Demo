// @vitest-environment jsdom

/**
 * The allocation, with a later closing's equalization on it: each part in its
 * own column — capital, late interest, catch-up fee — then the equalization
 * and what is due.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { compute, type CallModel } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail } from '@/adapters/storage/types';
import { AllocationTab } from '../allocation-tab';

afterEach(cleanup);

const show = (model: CallModel) =>
  render(<AllocationTab call={{ id: 'call-1', callNo: 3, model } as unknown as CallDetail} result={compute(model)} />);

describe('a call settling a later closing', () => {
  it('shows the equalization taken apart, and what is due', () => {
    const base = structuredClone(ILLUSTRATIVE_FUND);
    base.golden = null;
    const [a, b] = base.lps.map((l) => String(l.LP_ID));
    const model: CallModel = {
      ...base,
      equalizationSchedule: [
        {
          closingId: 'c2', closingNo: 2, closingDate: '2026-05-01',
          byLp: { [a]: 1_100, [b]: -1_050 },
          parts: { [a]: { capital: 1_000, interest: 50, catchUpFee: 50 }, [b]: { capital: -1_000, interest: -50, catchUpFee: 0 } },
        },
      ],
    };
    show(model);
    const head = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(head).toEqual(expect.arrayContaining(['Eq_Capital', 'Eq_Interest', 'Eq_Catch_Up_Fee', 'Equalization', 'Amount_Due']));
    const at = (label: string) => head.indexOf(label);
    const cells = (id: string) => [...(screen.getAllByText(id)[0].closest('tr') as HTMLElement).querySelectorAll('td')].map((td) => td.textContent);
    expect([at('Eq_Capital'), at('Eq_Interest'), at('Eq_Catch_Up_Fee'), at('Equalization')].map((i) => cells(a)[i])).toEqual([
      '1,000.00', '50.00', '50.00', '1,100.00',
    ]);
    expect([at('Eq_Capital'), at('Eq_Interest'), at('Eq_Catch_Up_Fee')].map((i) => cells(b)[i])).toEqual(['(1,000.00)', '(50.00)', '—']);
    // The total row: capital and interest net out between investors; what is left is the catch-up fee.
    const total = [...(screen.getByText('TOTAL').closest('tr') as HTMLElement).querySelectorAll('td')].map((td) => td.textContent);
    const offset = head.length - total.length; // the TOTAL label spans two columns
    expect([at('Eq_Capital'), at('Eq_Interest'), at('Eq_Catch_Up_Fee'), at('Equalization')].map((i) => total[i - offset])).toEqual([
      '—', '—', '50.00', '50.00',
    ]);
    expect(within(screen.getByRole('table')).queryByText('Eq_Capital')).toBeTruthy();
  });

  it('adds no equalization columns to a call that settles none', () => {
    const base = structuredClone(ILLUSTRATIVE_FUND);
    base.golden = null;
    show(base);
    expect(screen.queryByText('Eq_Catch_Up_Fee')).toBeNull();
    expect(screen.queryByText('Amount_Due')).toBeNull();
  });
});

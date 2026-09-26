// @vitest-environment jsdom

/**
 * The drawdown chart's figures. Its layout — bars standing on the baseline —
 * can only be seen in a browser; what it says can be checked here.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DrawdownChart, type DrawdownColumn } from '../drawdown-chart';

afterEach(cleanup);

const col = (callNo: number, total: number, cumulative: number): DrawdownColumn => ({
  callNo, callDate: '2026-06-01', href: `/funds/f/calls/c${callNo}`, total, againstCommitment: total, outsideCommitment: 0, feeNet: 0, cumulative, draft: false,
});

describe('the share of commitments drawn', () => {
  it('is measured against today’s commitments, so it never falls when a later close adds some', () => {
    // Claude Fund: 40m committed at Call 3, 45m after Closing 3 and at Call 4.
    render(
      <DrawdownChart
        columns={[col(1, 3_318_000, 3_318_000), col(2, 3_100, 3_321_100), col(3, 4_000_000, 7_321_100), col(4, 340_164.84, 7_661_264.84)]}
        totalCommitments={45_000_000}
        currency="USD"
      />,
    );
    const shares = screen.getAllByText(/% called$/).map((e) => e.textContent);
    expect(shares).toEqual(['7.4% called', '7.4% called', '16.3% called', '17.0% called']);
    expect(screen.getByText(/of USD 45,000,000 called across 4 calls/).textContent).toContain('17.0%');
  });
});

describe('a draft call', () => {
  it('is shown as not sent, adds nothing to what is called, and brings its legend with it', () => {
    render(
      <DrawdownChart
        columns={[col(1, 4_500_000, 4_500_000), { ...col(2, 900_000, 4_500_000), draft: true }]}
        totalCommitments={45_000_000}
        currency="USD"
      />,
    );
    expect(screen.getAllByText(/% called$/).map((e) => e.textContent)).toEqual(['10.0% called']);
    expect(screen.getByText('draft, not sent')).toBeTruthy();
    expect(screen.getByText('Draft, not sent yet')).toBeTruthy();
    expect(screen.getByText(/of USD 45,000,000 called across 1 call\./).textContent).toContain('10.0%');
  });

  it('leaves the legend out when there is no draft', () => {
    render(<DrawdownChart columns={[col(1, 4_500_000, 4_500_000)]} totalCommitments={45_000_000} currency="USD" />);
    expect(screen.queryByText('Draft, not sent yet')).toBeNull();
  });
});

describe('each column', () => {
  it('opens its call, and says what it is made of — to a pointer and to a screen reader', () => {
    const c = { ...col(1, 3_318_000, 3_318_000), againstCommitment: 3_162_000, outsideCommitment: 31_000, feeNet: 125_000 };
    render(<DrawdownChart columns={[c]} totalCommitments={45_000_000} currency="USD" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/funds/f/calls/c1');
    expect(link.getAttribute('aria-label')).toBe(
      'Call 1, 1 June 2026: USD 3,318,000.00: 3,162,000.00 against commitment, 31,000.00 outside commitment, 125,000.00 management fee. 7.4% of commitments called to date.',
    );
    const tip = link.querySelector('.dd-tip') as HTMLElement;
    expect(tip.textContent).toContain('Against commitment3,162,000.00');
    expect(tip.textContent).toContain('Outside commitment31,000.00');
    expect(tip.textContent).toContain('Management fee, net125,000.00');
    expect(tip.textContent).toContain('3,318,000.00 called to date · 7.4% of commitments');
  });
});

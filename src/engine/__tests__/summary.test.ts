import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { splitCall } from '@/engine/summary';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';

describe('splitting a call for presentation', () => {
  it('adds back to the total called', () => {
    const result = compute(ILLUSTRATIVE_FUND);
    const s = splitCall(result);
    expect(s.againstCommitment + s.outsideCommitment + s.feeNet).toBeCloseTo(s.total, 2);
  });

  it('separates the fee from what it draws against commitment', () => {
    const result = compute(ILLUSTRATIVE_FUND);
    const s = splitCall(result);

    // Deals and the partnership expense: 3m + 2m + 1.5m + 200k.
    expect(s.againstCommitment).toBeCloseTo(6700000, 2);
    // Organizational expense, called outside the commitment.
    expect(s.outsideCommitment).toBeCloseTo(150000, 2);
    // 237,500 gross less the 50,000 offset.
    expect(s.feeNet).toBeCloseTo(187500, 2);
    expect(s.total).toBeCloseTo(7037500, 2);
  });

  it('moves the fee to the outside column when the fund calls it that way', () => {
    const result = compute(SCENARIOS.feeOutsideCommitment);
    const s = splitCall(result);

    expect(s.againstCommitment).toBeCloseTo(6700000, 2);
    expect(s.outsideCommitment).toBeCloseTo(150000, 2);
    expect(s.feeNet).toBeCloseTo(187500, 2);
    expect(s.againstCommitment + s.outsideCommitment + s.feeNet).toBeCloseTo(s.total, 2);
  });

  it('adds up for every scenario', () => {
    for (const [name, model] of Object.entries(SCENARIOS)) {
      const s = splitCall(compute(structuredClone(model)));
      expect(
        s.againstCommitment + s.outsideCommitment + s.feeNet,
        `${name} does not add back to its total`,
      ).toBeCloseTo(s.total, 2);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { SCENARIOS } from '@/engine/fixtures/scenarios';
import type { NoticeState } from '@/adapters/storage/types';
import { actionableLpIds, canApprove, sendableLpIds } from '../notice-policy';

const notice = (lpId: string, status: NoticeState['status']): NoticeState => ({
  investorId: `id-${lpId}`,
  lpId,
  status,
  approvedAt: null,
  sentAt: null,
  sentToEmail: null,
});

describe('approving notices', () => {
  it('allows approval when every check passes', () => {
    expect(canApprove(compute(ILLUSTRATIVE_FUND).checks).ok).toBe(true);
  });

  it('refuses approval while a check is failing', () => {
    // Every participant has a zero basis, so the component cannot be allocated.
    const decision = canApprove(compute(SCENARIOS.zeroBasisComponent).checks);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/failing/i);
    expect(decision.reason).toMatch(/before approving/i);
  });

  it('allows approval over warnings, which are the accountant’s call', () => {
    // An investor called beyond their unfunded commitment warns, but can be
    // legitimate — recycling, or a default elsewhere in the fund.
    // The fixture drops the Expected_Output rows: they describe the fund as it
    // was, so moving an opening balance fails that check too and would mask the
    // warning this is about.
    const model = structuredClone(ILLUSTRATIVE_FUND);
    model.golden = null;
    model.lps[1].Opening_UCC = 1000;

    const checks = compute(model).checks;
    expect(checks.some((c) => c.level === 'warn')).toBe(true);
    expect(checks.some((c) => c.level === 'fail')).toBe(false);
    expect(canApprove(checks).ok).toBe(true);
  });
});

describe('deciding what may be sent', () => {
  const notices = [
    notice('LP01', 'approved'),
    notice('LP02', 'draft'),
    notice('LP03', 'sent'),
    notice('LP04', 'approved'),
  ];

  it('sends every approved notice when none is named', () => {
    expect(sendableLpIds(notices).send.sort()).toEqual(['LP01', 'LP04']);
  });

  it('never sends a draft, even when asked directly', () => {
    const { send, skipped } = sendableLpIds(notices, ['LP01', 'LP02']);
    expect(send).toEqual(['LP01']);
    expect(skipped).toEqual(['LP02']);
  });

  it('does not resend something already sent', () => {
    expect(sendableLpIds(notices, ['LP03']).send).toEqual([]);
  });

  it('reports an unknown investor rather than ignoring it', () => {
    expect(sendableLpIds(notices, ['LP99']).skipped).toEqual(['LP99']);
  });
});

describe('who can be acted on', () => {
  it('covers every active investor by default', () => {
    expect(actionableLpIds(compute(ILLUSTRATIVE_FUND))).toEqual([
      'LP01', 'LP02', 'LP03', 'LP04', 'LP05', 'GP01',
    ]);
  });

  it('excludes an investor who left through a full transfer', () => {
    const result = compute(SCENARIOS.fullTransfer);
    const ids = actionableLpIds(result);
    expect(ids).not.toContain('LP05');
    expect(ids).toContain('LP06');
  });

  it('ignores a requested investor who is not on this call', () => {
    expect(actionableLpIds(compute(ILLUSTRATIVE_FUND), ['LP01', 'LP99'])).toEqual(['LP01']);
  });
});

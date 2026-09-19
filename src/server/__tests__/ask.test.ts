/**
 * The Ask Axtara contract.
 *
 * Nothing here reaches a model. What is pinned is the part that would be wrong
 * without anyone noticing: a system prompt that has quietly drifted from the
 * rules the handoff sets, and a GOTO line shown to the reader as if it were a
 * sentence.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import type { CallDetail } from '@/adapters/storage/types';
import { buildFundContext } from '../fund-context';
import {
  NOT_CONNECTED,
  complete,
  pointerLabel,
  stripMarkdown,
  systemPrompt,
  takePointer,
} from '../ask';

const result = compute(ILLUSTRATIVE_FUND);
const active = result.rows.filter((r) => r.isActive);

function call(callNo: number): CallDetail {
  return {
    id: `call-${callNo}`,
    clientId: 'client-1',
    callNo,
    stage: 'in_progress',
    lockedAt: null,
    sources: { setup: 'template', lps: 'template', components: 'template', fee: 'template', transfers: 'template' },
    sourceFileName: null,
    model: ILLUSTRATIVE_FUND,
    notices: active.map((r) => ({
      investorId: `id-${r.LP_ID}`,
      lpId: r.LP_ID,
      status: 'draft' as const,
      approvedAt: null,
      sentAt: null,
      sentToEmail: null,
      delivery: null,
      deliveryError: null,
      deliveredTo: null,
    })),
  } as unknown as CallDetail;
}

const context = buildFundContext({ id: 'client-1', name: 'Illustrative Fund II, L.P.' }, [call(2)]);

describe('what the model is told', () => {
  it('states every rule the handoff sets', () => {
    const prompt = systemPrompt(context);
    for (const rule of [
      'Answer ONLY from the JSON fund data',
      'Plain text only',
      'Cite every figure to its source in brackets',
      'read-only',
      'GOTO:',
    ]) {
      expect(prompt, rule).toContain(rule);
    }
  });

  it('never claims the model can change anything', () => {
    // The whole difference between "the fee is X" and "I have set the fee to X"
    // in a tool that moves other people's money.
    expect(systemPrompt(context)).toContain('never claim to have changed anything');
  });

  it('carries the fund data it is meant to answer from', () => {
    const prompt = systemPrompt(context);
    expect(prompt).toContain('FUND DATA:');
    expect(prompt).toContain('Illustrative Fund II');
    // The figures, not just the names.
    expect(prompt).toContain(active[0].LP_ID);
    expect(prompt).toContain('"checks"');
    expect(prompt).toContain('expected_output_differences');
  });
});

describe('the snapshot', () => {
  it('describes every call, newest first', () => {
    const many = buildFundContext({ id: 'c', name: 'Fund' }, [call(1), call(3), call(2)]);
    expect((many.calls as { call_number: number }[]).map((c) => c.call_number)).toEqual([3, 2, 1]);
  });

  it('carries each investor’s notice status, so it can say what is unsent', () => {
    const one = (context.calls[0] as { allocation: { notice_status: string }[] }).allocation[0];
    expect(one.notice_status).toBe('draft');
  });

  it('says so when it had to leave older calls out', () => {
    // A fund with a long history outgrows one request. Dropping the oldest and
    // saying so beats sending half the data as though it were all of it.
    const lots = buildFundContext(
      { id: 'c', name: 'Fund' },
      Array.from({ length: 60 }, (_, i) => call(i + 1)),
    );
    expect(lots.calls.length).toBeLessThan(60);
    expect(lots.omitted).toMatch(/older calls? omitted/);
    // The most recent one always survives.
    expect((lots.calls[0] as { call_number: number }).call_number).toBe(60);
  });
});

describe('the pointer at the end of an answer', () => {
  it('becomes a link rather than a sentence', () => {
    const { reply, pointer } = takePointer(
      'Two notices are still in draft. [Call 2 · LP01]\nGOTO: 2|notices',
    );
    expect(reply).not.toContain('GOTO');
    expect(reply.trim().endsWith('[Call 2 · LP01]')).toBe(true);
    expect(pointer).toEqual({ callNo: 2, tab: 'notices' });
  });

  it('maps the contract’s "output" to the tab this app calls Allocation', () => {
    expect(takePointer('x\nGOTO: 3|output').pointer).toEqual({ callNo: 3, tab: 'allocation' });
    expect(pointerLabel({ callNo: 3, tab: 'allocation' })).toBe('Open Call No. 3 · Allocation');
  });

  it('leaves an answer with no pointer alone', () => {
    const { reply, pointer } = takePointer('The fee is 2.00% per annum. [Fund_Setup]');
    expect(pointer).toBeNull();
    expect(reply).toBe('The fee is 2.00% per annum. [Fund_Setup]');
  });

  it('strips the line even when it names a call that does not exist', () => {
    // It is an instruction to the interface, never something to read.
    const { reply, pointer } = takePointer('Nothing found.\nGOTO: 99|checks');
    expect(reply).toBe('Nothing found.');
    expect(pointer).toEqual({ callNo: 99, tab: 'checks' });
  });

  it('labels each tab the way the screen does', () => {
    expect(pointerLabel({ callNo: 1, tab: 'summary' })).toBe('Open Call No. 1 · Summary');
    expect(pointerLabel({ callNo: 1, tab: 'checks' })).toBe('Open Call No. 1 · Checks');
    expect(pointerLabel({ callNo: 1, tab: 'notices' })).toBe('Open Call No. 1 · Notices');
  });
});

describe('markdown the model was asked not to write', () => {
  it('is taken out rather than shown', () => {
    expect(stripMarkdown('**Total** is 5')).toBe('Total is 5');
    expect(stripMarkdown('## Heading\ntext')).toBe('Heading\ntext');
    expect(stripMarkdown('* one\n* two')).toBe('- one\n- two');
    expect(stripMarkdown('`LP01`')).toBe('LP01');
  });

  it('leaves a citation alone, brackets and all', () => {
    expect(stripMarkdown('[LP03 · Mgmt_Fee_Rate_Override 0.01]')).toBe(
      '[LP03 · Mgmt_Fee_Rate_Override 0.01]',
    );
  });
});

describe('when no model is configured', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('says so plainly instead of failing', async () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', '');
    vi.stubEnv('AZURE_FOUNDRY_DEPLOYMENT', '');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');

    await expect(complete('system', [])).resolves.toBe(NOT_CONNECTED);
    expect(NOT_CONNECTED).toContain('not connected');
  });
});

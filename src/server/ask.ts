/**
 * Ask Axtara: the rules, the request, and what comes back.
 *
 * Separated from the route handler so the prompt and the parsing can be tested
 * without a server or a model — the two things most likely to go quietly wrong
 * are the system prompt drifting from the contract and a GOTO line being shown
 * to the reader instead of turned into a link.
 */

import { foundryEnv } from '@/lib/env';
import type { FundContext } from './fund-context';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * What the model may and may not do.
 *
 * Read-only is stated three ways on purpose. This model sits in front of a tool
 * that moves other people's money, and the difference between "the fee is X"
 * and "I have changed the fee to X" is the whole product.
 */
export function systemPrompt(context: FundContext): string {
  return [
    'You are the analyst for a private-equity fund administration tool.',
    'Answer ONLY from the JSON fund data provided; if the answer is not in the data, say so briefly.',
    'Be concise (2-5 sentences or a short list).',
    'Plain text only: no Markdown, no asterisks, no headings, no tables; use a simple "- " dash for list items.',
    'Cite every figure to its source in brackets, e.g. [LP03 · Mgmt_Fee_Rate_Override 0.01 · SL-2024-03] or [Call 2 · Deal Z · Allocation_Basis UCC].',
    'Use the reporting currency with thousands separators.',
    'Never invent data, never give investment or legal advice, and never claim to have changed anything — this is read-only.',
    "If useful, end with one line 'GOTO: <call_number>|<tab>' where tab is summary, output, checks or notices, to point the user at the relevant screen; otherwise omit it.",
    '',
    'FUND DATA:',
    JSON.stringify(context),
  ].join('\n');
}

/**
 * Markdown the model was asked not to produce.
 *
 * A fallback, not a formatter: the prompt already forbids it, and this only
 * stops the occasional stray asterisk being read aloud as punctuation.
 */
export function stripMarkdown(reply: string): string {
  return String(reply || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/`/g, '');
}

/** Where an answer points, once the trailing GOTO line is taken out of it. */
export interface Pointer {
  callNo: number;
  tab: 'summary' | 'allocation' | 'checks' | 'notices';
}

/**
 * Pulls the GOTO line out of a reply.
 *
 * The line is an instruction to the interface, not a sentence for the reader,
 * so it always leaves the text even when it names a call that does not exist.
 *
 * The contract's `output` is this app's Allocation tab — the tab that
 * reproduces the accountant's Expected_Output.
 */
export function takePointer(reply: string): { reply: string; pointer: Pointer | null } {
  const match = /GOTO:\s*(\d+)\s*\|\s*(summary|output|checks|notices)/i.exec(reply);
  if (!match) return { reply: reply.trim(), pointer: null };

  const tab = match[2].toLowerCase();
  return {
    reply: reply.replace(match[0], '').trim(),
    pointer: {
      callNo: Number(match[1]),
      tab: tab === 'output' ? 'allocation' : (tab as Pointer['tab']),
    },
  };
}

/** How the link reads under the answer. */
export function pointerLabel(pointer: Pointer): string {
  const tab = pointer.tab === 'allocation' ? 'Allocation' : capitalise(pointer.tab);
  return `Open Call No. ${pointer.callNo} · ${tab}`;
}

const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1);

/** What the panel says when no model is configured for this deployment. */
export const NOT_CONNECTED =
  'Axtara is not connected in this deployment yet. Once an endpoint is configured it will ' +
  "answer from this fund's register, allocations, checks and notice status — with every " +
  'figure cited to its row.';

/**
 * Ask the model.
 *
 * Azure AI Foundry speaks the Azure OpenAI chat-completions shape. The key
 * never leaves the server: this function is only ever called from a route
 * handler, and `foundryEnv()` throws outright if it is reached in a browser.
 */
export async function complete(system: string, history: Message[]): Promise<string> {
  const config = foundryEnv();
  if (!config) return NOT_CONNECTED;

  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, ...history],
      max_tokens: 700,
      // Low, not zero: the same question twice should give the same figures.
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message || `The model returned ${response.status}.`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? '';
}

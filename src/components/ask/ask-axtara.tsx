'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { SendArrow } from '@/components/shell/icons';
import {
  getServerState,
  getState,
  patchLastTurn,
  setState,
  setTurns,
  subscribe,
  turnsFor,
  type Turn,
} from './store';

/** What the bar says it is doing, in order, while it waits. */
const WAITING = [
  'Reading the register',
  'Checking the allocation',
  'Tracing the figures to their rows',
  'Composing the answer',
];

/** One shared empty thread, so a fund with no conversation is a stable value. */
const NO_TURNS: Turn[] = [];

/** Which screen the question is being asked from. */
export type Surface = 'home' | 'setup' | 'call' | 'module';

/**
 * Ask Axtara.
 *
 * A command bar rather than a side panel: the question is almost always about
 * what is on screen, so the screen stays visible behind it and the answer lands
 * over the figures it cites.
 *
 * It reads. It cannot approve a notice, change an input or send anything, and
 * the footer says so on every answer — a tool that moves other people's money
 * should never leave that ambiguous.
 */
export function AskAxtara({
  clientId,
  fundName,
  surface,
  connected,
}: {
  clientId: string;
  fundName: string;
  surface: Surface;
  /** False when no model endpoint is configured; the panel then says so. */
  connected: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'summary';
  const state = useSyncExternalStore(subscribe, getState, getServerState);
  // Named separately so the scroll effect below can depend on the thread
  // itself: `?? []` would be a fresh array on every render and scroll forever.
  const thread = state.threads[clientId];
  const turns = thread ?? NO_TURNS;

  const input = useRef<HTMLTextAreaElement>(null);
  const threadEl = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    input.current?.blur();
    setState({ open: false });
  }, []);

  // Ctrl/⌘K from anywhere, Escape to leave. A keyboard shortcut is the point of
  // a command bar; without it this is just a button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setState({ open: !getState().open });
      } else if (e.key === 'Escape' && getState().open) {
        setState({ open: false });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (state.open) input.current?.focus({ preventScroll: true });
  }, [state.open]);

  useEffect(() => {
    const el = threadEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || getState().busy) return;

    const existing = turnsFor(clientId);
    setTurns(clientId, [
      ...existing,
      { question: text, answer: null, shown: '', streaming: false, goto: null },
    ]);
    setState({ draft: '', busy: true, thinking: 0 });

    const ticker = window.setInterval(
      () => setState({ thinking: Math.min(WAITING.length - 1, getState().thinking + 1) }),
      1400,
    );

    // Only the question and the conversation go up. The register, the
    // allocation and the checks are assembled on the server from the database,
    // so no fund data has to be held in the browser to ask about it.
    let reply = '';
    let goto: Turn['goto'] = null;
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          question: text,
          history: existing
            .filter((t) => t.answer)
            .slice(-4)
            .flatMap((t) => [
              { role: 'user', content: t.question },
              { role: 'assistant', content: t.answer as string },
            ]),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Ask Axtara could not answer.');
      reply = body.reply ?? '';
      goto = body.goto ?? null;
    } catch (e) {
      reply = e instanceof Error ? e.message : 'Ask Axtara could not answer.';
    }

    window.clearInterval(ticker);
    setState({ busy: false, arriving: true });
    window.setTimeout(() => setState({ arriving: false }), 1100);

    // Revealed a word or two at a time. The answer is already complete — this
    // is pacing, not streaming, and it is what makes a wall of figures
    // readable as it lands rather than all at once.
    patchLastTurn(clientId, { answer: reply, shown: '', streaming: true });
    const words = reply.split(/(\s+)/);
    let i = 0;
    await new Promise<void>((done) => {
      const step = () => {
        if (i >= words.length) {
          patchLastTurn(clientId, { streaming: false, shown: reply, goto });
          return done();
        }
        const take = 1 + Math.floor(Math.random() * 2);
        const next = words.slice(0, i + take).join('');
        i += take;
        patchLastTurn(clientId, { shown: next });
        window.setTimeout(step, 18 + Math.random() * 30);
      };
      step();
    });
  }

  const greeting =
    surface === 'home'
      ? `What would you like to know about ${fundName.replace(/,?\s*L\.?P\.?$/i, '')}?`
      : tab === 'notices'
        ? 'Anything about the notices for this call?'
        : tab === 'checks'
          ? 'Want a check explained?'
          : "Anything about this call's allocation?";

  const suggestions =
    surface === 'home'
      ? [
          'How much of total commitments has been drawn so far?',
          'Which investors have the largest unfunded commitment?',
          'When is the next payment due and for how much?',
        ]
      : tab === 'notices'
        ? [
            'Which notices are still unsent?',
            'Summarise what LP01 is being asked to pay and why.',
            'Who has no contact email on file?',
          ]
        : tab === 'checks'
          ? [
              'Are any checks failing and what do they mean?',
              'Does the engine tie to Expected_Output?',
              'Was the organisational expense cap respected?',
            ]
          : [
              'Which items are called outside commitment?',
              'Why is one investor’s fee lower than the others?',
              'How was each component allocated?',
            ];

  return (
    <>
      <button
        type="button"
        className={['ax-backdrop', state.open ? 'open' : ''].filter(Boolean).join(' ')}
        data-noprint="1"
        tabIndex={-1}
        aria-hidden
        onClick={close}
      />

      <div
        className={['ax-dock', state.open ? 'open' : ''].filter(Boolean).join(' ')}
        data-noprint="1"
        role="dialog"
        aria-label="Ask Axtara"
        aria-modal={state.open || undefined}
      >
        {turns.length > 0 && (
          <div
            ref={threadEl}
            className={['ax-thread', state.arriving ? 'arrive' : ''].filter(Boolean).join(' ')}
          >
            {turns.map((turn, i) => (
              <div className="ax-turn" key={i}>
                <div className="ax-q">{turn.question}</div>

                {turn.answer === null && state.busy && i === turns.length - 1 && (
                  <div className="ax-wait">
                    <span className="ax-think">{WAITING[state.thinking]}…</span>
                    <span className="line" />
                    <span className="ghost">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}

                {turn.answer !== null && (
                  <div className="ax-a">
                    {citeParts(turn.shown).map((part, j) =>
                      part.cite ? (
                        <span className="cite" key={j}>
                          {part.text}
                        </span>
                      ) : (
                        <span key={j}>{part.text}</span>
                      ),
                    )}
                    {turn.streaming && <span className="ax-cursor" />}
                    {turn.goto && (
                      <div style={{ marginTop: 10 }}>
                        <a
                          href={turn.goto.href}
                          onClick={(e) => {
                            e.preventDefault();
                            close();
                            router.push(turn.goto!.href);
                          }}
                        >
                          {turn.goto.label} →
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="ax-foot">
              <span>Answers only from this fund’s data · read-only</span>
              <button type="button" onClick={() => setTurns(clientId, [])}>
                Clear conversation
              </button>
            </div>
          </div>
        )}

        {turns.length === 0 && (
          <>
            <div className="ax-greet">
              <h2>{greeting}</h2>
              <p>
                {connected
                  ? `Grounded in ${fundName} · every figure cited to its row · read-only`
                  : 'Not connected yet — no model endpoint is configured for this deployment.'}
              </p>
            </div>
            <div className="ax-chips">
              {suggestions.map((s) => (
                <button type="button" className="chip" key={s} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        <form
          className="ax-bar"
          onSubmit={(e) => {
            e.preventDefault();
            ask(state.draft);
          }}
        >
          <span className={['wordmark', state.busy ? 'live' : ''].filter(Boolean).join(' ')}>
            Axtara
          </span>
          <textarea
            ref={input}
            className="chat-input"
            rows={1}
            placeholder="Ask Axtara about this fund…"
            aria-label="Ask Axtara about this fund"
            value={state.draft}
            onChange={(e) => setState({ draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(state.draft);
              }
            }}
          />
          <span className="ax-hint">
            <kbd>↵</kbd> ask <kbd>esc</kbd> close
          </span>
          <button className="ax-send" type="submit" disabled={state.busy} title="Ask">
            <SendArrow />
          </button>
          <button className="ax-x" type="button" onClick={close} title="Close">
            ×
          </button>
        </form>
      </div>
    </>
  );
}

/** The button in the top bar. Separate so the bar does not own the panel. */
export function AskTrigger() {
  return (
    <button
      type="button"
      className="ax-trigger"
      title="Ask Axtara (Ctrl/⌘ K)"
      onClick={() => setState({ open: !getState().open })}
    >
      <span>Ask Axtara</span>
      <span className="ax-badge">Beta</span>
    </button>
  );
}

/**
 * Splits an answer into running text and the citations inside it.
 *
 * Every figure is supposed to arrive tagged with the row it came from —
 * `[LP03 · Mgmt_Fee_Rate_Override 0.01]` — and those read as data, not prose,
 * so they are set in mono and taken out of the sentence's flow.
 */
export function citeParts(text: string): { cite: boolean; text: string }[] {
  return text
    .split(/(\[[^\]\n]{3,80}\])/g)
    .filter(Boolean)
    .map((part) =>
      /^\[.*\]$/.test(part)
        ? { cite: true, text: part.slice(1, -1) }
        : { cite: false, text: part },
    );
}

/**
 * The conversation, per fund, for as long as the tab is open.
 *
 * Kept outside React because the shell is mounted by each page rather than by a
 * layout: without this, walking from the call list into a call would throw the
 * conversation away mid-answer. Nothing is persisted — a question about a call
 * is about the call as it stands now, and a stale answer is worse than none.
 */

export interface Turn {
  question: string;
  /** Null while the question is in flight. */
  answer: string | null;
  /** How much of `answer` has been revealed. */
  shown: string;
  streaming: boolean;
  /** Where the answer says to look, once it has finished arriving. */
  goto: { href: string; label: string } | null;
}

interface State {
  open: boolean;
  /** Keyed by client id. */
  threads: Record<string, Turn[]>;
  draft: string;
  busy: boolean;
  /** Index into the waiting phrases. */
  thinking: number;
  /** True for the 1.1s the thread's border flashes as an answer lands. */
  arriving: boolean;
}

let state: State = { open: false, threads: {}, draft: '', busy: false, thinking: 0, arriving: false };
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getState = () => state;

/** The server renders nobody's conversation. */
export const getServerState = (): State => EMPTY;
const EMPTY: State = { open: false, threads: {}, draft: '', busy: false, thinking: 0, arriving: false };

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function turnsFor(fundId: string): Turn[] {
  return state.threads[fundId] ?? EMPTY_TURNS;
}
const EMPTY_TURNS: Turn[] = [];

export function setTurns(fundId: string, turns: Turn[]) {
  setState({ threads: { ...state.threads, [fundId]: turns } });
}

/** Replace the last turn — the one being answered. */
export function patchLastTurn(fundId: string, patch: Partial<Turn>) {
  const turns = turnsFor(fundId);
  if (!turns.length) return;
  const next = turns.slice();
  next[next.length - 1] = { ...next[next.length - 1], ...patch };
  setTurns(fundId, next);
}

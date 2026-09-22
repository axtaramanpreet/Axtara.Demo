# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Axtara Capital Call Engine: a fund-administration app (Next.js 16 App Router,
React 19, TypeScript, Supabase). Per fund it holds a history of capital calls,
takes the accountant's input workbook or manual entry, allocates each call
across investors, runs tie-out checks, and produces one notice per investor
through Draft → Approved → Sent. Production is `https://fund.axtara.ai` on
Vercel. `docs/` is a seven-chapter walkthrough of the system (engine, data,
workbook, screens, notices, Ask Axtara, running it), each ending with the gaps
found while writing it.

## Commands

Local Supabase runs in Docker, so Docker Desktop must be running.

```bash
npm run db:start          # start local Supabase (prints local keys)
npm run db:reset          # apply migrations + supabase/seed.sql
npm run dev               # http://localhost:3000, sign in dev@axtara.local / password

npm run verify            # tsc (tsconfig.check.json) + eslint --max-warnings=0 + vitest
npm run build             # next build
npm run db:test           # pgTAP tests in supabase/tests/
npm run db:types          # regenerate src/adapters/storage/database.types.ts after a migration

npx vitest run src/engine/__tests__/golden.test.ts   # one file
npx vitest run -t "plug is chosen"                    # by test name
```

- `verify` type-checks with `tsconfig.check.json`, which includes tests;
  `next build` uses `tsconfig.json`, which excludes them. Run both.
- Storage integration tests (`src/adapters/storage/__tests__/`) need the local
  stack; without it they `describe.skipIf` and print a warning. Skipped is not
  passing.
- Tests are `.test.ts` / `.test.tsx` under `src/`, default environment `node`.
  Component tests that need a DOM start with `// @vitest-environment jsdom`
  (see `notices-tab.dom.test.tsx`). jsdom has no layout: overlap, clipping and
  click interception can only be checked in a real browser.
- After any `npm install`, Vitest's native binding can break (npm
  optional-dependency bug). Fix: `rm -rf node_modules package-lock.json && npm install`.
- Docker's clock drifts after sleep and PostgREST then rejects tokens with
  `JWT issued at future`. Restart the stack.

## Architecture

```
src/engine/             pure calculation — no I/O, no clock, no framework imports
src/adapters/workbook/  .xlsx → CallModel (SheetJS, loaded on demand)
src/adapters/storage/   CallRepository over Supabase; row <-> model mappers
src/server/             server-only: approve/send, PDF, email, Ask Axtara
src/app/                routes; pages are server components
src/components/         client islands (setup, call tabs, shell, ask dock)
supabase/migrations/    schema, immutability triggers, RLS, views, RPCs
```

### The engine is the source of truth

`compute(model: CallModel): ComputeResult` in `src/engine/compute.ts` is pure
and deterministic. Order is fixed: transfers → component allocation → fee and
offsets → per-LP roll-forward → tie-out checks → comparison with the
accountant's `Expected_Output` (`model.golden`). Every split goes through
`allocate()` (pro-rata, with the residual cent given to one "plug" LP so each
allocation ties exactly). `num()` and `round()` in `format.ts` are what make
figures match the workbook to the cent; do not change them without the engine
suite.

- `src/engine/fixtures/illustrative-fund.ts` is both the "load template" data
  and the primary regression fixture. Its `golden` rows are transcribed from
  the accountant's workbook — never regenerate them from engine output.
- `equivalence.test.ts` and the workbook parser tests import the original
  implementation from `design_handoff_capital_call_engine 2/` (read-only
  reference, kept in the repo). Deliberate divergences are asserted there, not
  tolerated.
- Business rules live in the engine as `ok`/`warn`/`fail` checks. The database
  owns structure only (types, keys, uniqueness, immutability). A `fail` check
  blocks approval; a `warn` does not.
- Do not have the UI or the LLM derive figures the engine can compute.

### Three Supabase clients, three authorities

`src/adapters/storage/supabase-client.ts`:

- **browser** (`createBrowserSupabase`) and **server** (`getServerSupabase` in
  `src/lib/supabase/server.ts`) act as the signed-in user; RLS applies.
- **service** (`createServiceSupabase`) bypasses RLS. It is used only in
  `src/server/call-actions.ts`.

`notices`, `call_results` and `audit_log` have read policies only, so approving
and sending can only happen server-side via `/api/calls/[callId]/notices`.
`call-actions.ts` recomputes from stored inputs (the browser names investors,
never amounts), refuses approval while a check fails (`notice-policy.ts`), and
freezes a snapshot with the engine version before sending.

### Issued calls are immutable

A draft call stores inputs only and is recomputed on demand. Sending the first
notice locks the call; database triggers (`*_immutability.sql`) then reject
input changes with SQLSTATE `23001`, which `asError()` turns into a readable
message. Corrections are a new call. Enforced in the database rather than app
code because the service role bypasses RLS.

Saving inputs goes through the `save_call_inputs` RPC so the register,
components, offsets and transfers are replaced atomically.

### Ask Axtara

`/api/ask` (Node runtime) → `src/server/fund-context.ts` builds a JSON snapshot
of the fund, read fresh per question **as the signed-in user** (never the
service client) → `src/server/ask.ts` calls Claude through
`@anthropic-ai/foundry-sdk` (`AnthropicFoundry`). Counts the model reports
(e.g. `notice_summary`) are precomputed in the snapshot rather than left to the
model. A reply may end with a `GOTO:` line naming a call and tab; `takePointer`
strips it and the route turns it into a link.

### Environment

Names are in `.env.example`; values live in `.env.local` (gitignored) and in
Vercel. `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and
`ANTHROPIC_FOUNDRY_KEY` are server-only and must never get a `NEXT_PUBLIC_`
prefix. `foundryEnv()` and `emailEnv()` in `src/lib/env.ts` throw if called in
the browser. `EMAIL_OVERRIDE_TO`, when set, redirects every notice email to
that address.

### UI conventions

- Dates and timestamps render through `fmtDate` / `fmtStamp`, pinned to UTC.
  Vercel renders in UTC; any unpinned `toLocale*` call causes a hydration
  mismatch (React #418) in production only.
- Theme (`dark`) and collapsed sidebar (`rail`) are written onto `<html>` by a
  pre-paint inline script (`THEME_INIT_SCRIPT` in `src/components/theme.tsx`)
  to avoid hydration mismatch.
- Styling is plain CSS in `src/app/globals.css` with tokens on `:root`. Grid
  and flex children that hold long content need `min-width: 0`.
- Icon-only `<Button iconOnly>` requires an `aria-label` at the type level.

## Working in this repo

- `main` and `feat/capital-call-engine` are both on GitHub (`origin`).
- Production deploys are done with the Vercel CLI (`vercel --prod`). Do not
  commit or deploy after a change: verify, leave it uncommitted, report, and
  ask. Commit only when the user says commit; deploy only when they say deploy.

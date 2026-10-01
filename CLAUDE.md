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
npm run demo:reset        # rebuild the Meridian Growth Partners III demo fund (local only)

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

### Names: clients on top, funds underneath

`clients` is the top level (a GP or manager; users belong to one through
`client_members`), and `funds` sit under it. Everything a fund owns hangs off
`fund_id`. Pages live at `/funds/[fundId]/…`; `/clients/…` links from before the
rename forward there (`next.config.ts`). Plain `client` in the code can also mean
a Supabase or email client, or a client component, so read it in context.

### Fund terms

`fund_terms` holds a fund's settings as a dated, add-only history: a change is a
new row from the date it applies, never an edit (a trigger refuses updates and
deletes, except when the whole fund is deleted). `termsOn(history, date)` in
`src/engine/fund-terms.ts` picks the row in force. `applyFundTerms(model, terms)`
puts it into a call and returns which cells it locked; the setup screen applies
it (terms in force on the call date) on load, on every edit, and when inputs are
replaced, never on an issued call. Once a fund has terms, every fund-level
cell comes from them and is locked — a blank term is blank on the call, and a
workbook's values for those cells are ignored and reported. A fund with no terms
behaves as before. Env `NOTICE_*` values are the base a new call starts from,
under the terms. Blank means "not set"; the
Settings form's suggestions (`SUGGESTED_TERMS`) are never stored unless recorded.
Editing terms asks what the edit is: "Fix a mistake" (a new row on the
original start date, which wins the tie) or "The terms change from a date".
Nothing issued is recalculated — sent calls and finalised closings stay as they
are; periods calls already billed show a true-up. `termsEditImpact` (`fee-billing.ts`)
lists all of it, with amounts, before the edit is recorded.
Terms that only apply once another is set (`DEPENDS_ON`: how the fee is
charged needs a fee rate; interest basis and recipient need a late-close rate)
are hidden in the form and stored as null (`withoutOrphans`). Field labels,
help text and parsing ("2%", "Quarterly", "Yes") live in
`src/lib/fund-terms-fields.ts`, shared by the screen and the terms template.

### Investors

`investors` is the fund's register and the Investors page owns each profile
(type, country, notices email, `cc_emails` copied on every notice, `is_gp`,
`kyc_status`). Calls and closings create investors they don't know, and a
non-blank detail typed on them updates the profile, but a blank never clears
one (`save_call_inputs`, `save_closing_commitments`, migration
`20260927090000`); `fromLPRowIdentity` must send blanks as blanks for that to
hold. `profileGaps` (`src/lib/investor-profile.ts`) is the one rule for
"profile incomplete". `capitalAccount` (`src/engine/capital-account.ts`) ends on
the same figures as `positionsOn`; the billed fee is inside each call. No tax IDs or investor bank details are stored until the
rebuild encrypts them. Under `EMAIL_OVERRIDE_TO`, copies are dropped too.

### Setup order and templates

`src/lib/fund-gates.ts` decides what a fund may do next: closings need terms,
new calls and fees need a finalised first close. Funds that already have calls
or closings are exempt. Every page passes `fundGates(progress)` to `AppShell`;
the sidebar shows locked items, Closings and Fees show `StepGate`, and the home
checklist (terms → investors → first close → first call) disables later steps; investors are not a gate, since a closing can add them. It is a UI rule — the database does not enforce
it — except that `finaliseClosing` refuses when no terms are in force on the
closing date. `src/adapters/workbook/templates.ts` builds and reads the terms,
commitments and call templates; an import only fills a form, never saves.

### Closings, equalization and the fee ledger

The fund's record is `closings` + `closing_commitments` (who each close
admitted), issued calls (their frozen `call_results`), `closing_results` (a
finalised later close's equalization, frozen). There are no fee runs: the fee
is read from the calls that bill it. `src/engine/fund-history.ts` reads it the same way for everything:
`equalizationInputFor`, `positionsOn`, `feeInvestorsFrom`, `feeLedgerFor`.
Only finalised closings count; a draft is previewed, never counted.

- `equalize()` (`equalization.ts`): capital moved = called × N/(T+N) per earlier
  call, split among late investors by commitment and refunded by what each
  holds of that call — what they paid, as moved by earlier closings'
  equalization (`equalizationInputFor`); interest per call from its due date
  to the closing (`interestOnCalls`); catch-up fee from `feeForRange` over
  the fee periods already billed to the others (`catchUpFeeThrough`; blank
  `catchUpFeeUntil` = `billed_periods`, or `closing_date` for every day to the
  closing), recorded as `totals.feeCoveredThrough` — `feeInvestorsFrom` starts
  the late commitment's fee the day after, so later periods bill them in full
  (older results without it: from the closing date); and
  interest on it (`catchUpFeeInterest`: from the first close by default, or
  per period, or none) as its own part `feeInterest`, paid where the fee goes,
  at `catchUpFeeInterestRateOf` — its own rate, blank = the late-close rate
  (recorded as `totals.feeInterestRate`).
- Interest runs to when the late investor pays by default
  (`equalizationInterestUntil` blank = `collection_due_date`; blank is the FM
  rule here, not "not set"). The frozen result stops at the closing; the
  collecting call (its `Payment_Due_Date`) or statement (its
  `payment_due_date`, picked at approval, suggested closing + 10 working days)
  re-dates it with `equalizationRunTo` — never by equalizing again. Interest
  never moves paid-in or unfunded.
- Settled on the next call, balances move on that call, not on the closing
  (`equalizationMovements`, read by `positionsOn` and `capitalAccount`):
  until it the late investor is at nothing paid and full commitment unfunded.
  New schedule entries carry `settles: 'on_call'`; `compute()` then adds
  `eqPaid` / `eqReduces` to the closing balances and shares UCC-basis
  components on unfunded after the equalization. Entries without `settles`
  (sent before the rule) moved balances on the closing date and still do.
  Invested capital stays dated at the closing. A closing is not settled now
  while an earlier one waits for its call, nor made to wait after a later one
  was settled now (`settlementConflict`, enforced by finalise and the
  settlement change): it would refund capital not yet paid.
- `feeForRange()` (`fee-run.ts`) slices a period wherever terms, commitment or
  invested capital change; `trueUp()` keeps charged, should-have and the
  difference. `feeLedgerFor` (`fee-billing.ts`) compares every period with what
  calls billed — not billed, billed, or "true-up due" once the record moves
  after billing — with nothing entered by hand (`fee_runs` was dropped in
  `20260927140000`).
- `fundRegister()` (`fund-register.ts`) builds a new call's register from the
  record once the fund has closings (carry-forward would miss a later close).
  It refuses, naming the call, when a call's commitments disagree with the
  closings — usually a transfer made inside a call.
- `registerDifferences()` compares any call's register (typed, imported,
  carried) with the record before it: unknown or missing LP_IDs, and
  commitment, opening paid-in or unfunded that differ. Setup lists them with
  "Use the fund's register"; `approveNotices` and `sendNotices` refuse while any
  remain, or while a fund with terms has none in force on the call date. On
  import, known investors' identity comes from their profile
  (`identityFromProfiles`), not the workbook.
- Finalising and recording go through `fund-actions.ts` (server recomputes,
  refuses on a failing check, writes with the service role, audits). Browsers
  can edit only draft closings, through RLS and column grants.
- Home's Fund position card reads `positionFromRecord` for a fund with
  finalised closings whose calls agree with them; any other fund keeps the
  `fund_positions` view (the latest call's register, opening balances).

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
- A component's category is one of three (`src/engine/categories.ts`): Deal
  (invested capital), Partnership Expense, Organizational Expense (cap check).
  `categoryOf` accepts spacing, case, plurals and common synonyms; anything else
  is a `fail` check until picked. The management fee is never a component — it
  is computed in its own step — and a call with no components is a fee-only call.
- **Fee billing, funds with closings** (`src/engine/fee-billing.ts`, same test
  as `positionFromRecord`): a call bills named fee periods. `calls.fee_schedule`
  (`model.feeSchedule`) stores, per period, each investor's fee as the record
  worked it out; `compute()` sums it instead of rate × share of a year. A call
  bills what a period still owes — its fee now (`feeRunFor`) less what sent calls
  billed (`feeOwed`) — so nothing is billed twice, several past periods can go
  on one call (credit line), and a late closer's share of a billed period is
  still owed. Negative remainders are credits, reported not billed. Approve and
  send refuse a missing or stale schedule (`feeScheduleDifferences`). The fee
  ledger compares against what was billed once a period is billed.
- **Settling a later closing's equalization** (`src/engine/equalization-billing.ts`).
  `closings.settlement` is `on_closing` (statements now), `next_call`, or null
  (not chosen — every closing finalised before this existed). The choice
  decides which document asks for the cash and when balances move (closing
  date when settled now, the collecting call when settled on it — see above),
  and stays open until a sent call carried it or a statement was sent (the
  trigger enforces both). A call after
  an unchosen closing is refused approval (`unsettledClosings`).
  - Next call: `calls.equalization_schedule` (`model.equalizationSchedule`) is
    derived in setup (`withEqualization`, on load and every edit), never typed:
    everything still owed (`equalizationOwed`), settled in full on that call,
    kept per investor both as a net (`byLp`) and in its parts (`parts`:
    capital and its `inside` share, late interest, catch-up fee, fee interest
    — `compute` fails if they don't add up). Setup shows capital and interest
    on Call components and the fee parts on Management fee; the notice shows one block per closing with the
    parts and their total.
    A credit larger than an investor's call is paid to them: `amountDue` goes
    negative and the notice says "Amount payable to you", asking for nothing
    (`payableToYou`). `compute`
    adds `row.equalization`; `row.total` stays what the call draws. The
    roll-forward takes only `eqPaid` / `eqReduces` (capital and fee, on
    `settles: 'on_call'` entries), never interest. The amount to wire is `amountDue(row)` — use it
    wherever a figure means "pay this" (notice, email, allocation, export).
    Fields appear only when a call carries some, so the equivalence suite holds.
  - Now: `closing_statements` (server-only writes, read RLS, frozen once sent);
    `approveStatements` / `sendStatements` / `retryStatementDelivery` in
    `fund-actions.ts`.
- **Catch-up fees** (`catchUpFeesFor`): what late investors paid for the time
  before they joined, per closing, shown on Management fees. It is not in any
  period's figure; it is manager fee income only when `catchUpFeeTo` is the GP.
- **Funds without closings** keep rate × share of a year: `calls.charge_mgmt_fee`
  (`Charge_Mgmt_Fee` = 'N') leaves the fee and its offsets out, and approve/send
  refuse a second charge in one period (`callFeePeriod`, `feeAlreadyCharged`).

### Three Supabase clients, three authorities

`src/adapters/storage/supabase-client.ts`:

- **browser** (`createBrowserSupabase`) and **server** (`getServerSupabase` in
  `src/lib/supabase/server.ts`) act as the signed-in user; RLS applies.
- **service** (`createServiceSupabase`) bypasses RLS. It is used only in
  `src/server/call-actions.ts` and `src/server/fund-actions.ts`.

Those two modules take an optional signed-in client (`options.client`,
`src/server/session.ts`); without one they use the request's cookies. It exists
so `scripts/demo/reset.demo.ts` can drive the real approve / send / finalise /
fee-run code as a user. `sendNotices(…, { deliver: false })` issues without
emailing.

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
- Nothing saves by itself: every financial input is saved by an explicit
  Save or Record, and `useLeaveGuard` (`src/lib/hooks/use-leave-guard.ts`)
  asks before unsaved work is left. Do not add autosave.
- Irreversible steps (finalise a closing, delete a call or draft) confirm with
  `ConfirmDialog`, which states what is being fixed; never `window.confirm`.
- While a fund is being set up, `nextStep()` (`src/lib/fund-gates.ts`) puts a
  "Next: …" banner on the page whose step is done; imports preview what they
  will change before saving.

## Working in this repo

- `main` and `feat/capital-call-engine` are both on GitHub (`origin`).
- Production deploys are done with the Vercel CLI (`vercel --prod`). Do not
  commit or deploy after a change: verify, leave it uncommitted, report, and
  ask. Commit only when the user says commit; deploy only when they say deploy.

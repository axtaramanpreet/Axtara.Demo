# Capital Call Engine

A fund-accounting tool for capital calls. Per fund it keeps a history of calls,
takes the accountant's input workbook or manual entry, allocates the call across
investors, runs tie-out checks, and produces one Capital Call Notice per
investor with a Draft → Approved → Sent workflow.

Built from the design handoff in `design_handoff_capital_call_engine 2/`, which
stays in the repo as read-only reference — the engine and parser test suites
compare against its original implementation.

## Running it locally

You need **Docker Desktop running** (Supabase runs in containers) and Node 24.

```bash
npm install
npm run db:start      # first run pulls images, takes a few minutes
npm run db:reset      # applies migrations and the seed
npm run dev           # http://localhost:3000
```

Sign in with **dev@axtara.local** / **password**.

The seed creates two funds: *Illustrative Fund II* with a call in progress that
ties to the accountant's Expected_Output tab, and *Illustrative Fund III* with
no calls, which is the empty state.

`npm run db:stop` when you are done.

### Configuration

`npm run db:start` prints the local keys. Copy `.env.example` to `.env.local` —
the values already there are the Supabase CLI's well-known local defaults, which
are the same on every machine and valid only against `127.0.0.1`.

`SUPABASE_SERVICE_ROLE_KEY` and the Azure keys are server-only. Never give them
a `NEXT_PUBLIC_` prefix: that compiles them into the browser bundle, and the
service-role key bypasses every row-level security policy.

## Checks

```bash
npm run verify     # types, lint, unit and integration tests
npm run db:test    # pgTAP: policies, immutability, atomicity
```

`npm run verify` needs the local stack running — the tests that drive a real
Postgres skip loudly without it, which is not the same as passing.

After changing a migration, regenerate the types: `npm run db:types`.

## Learning it

`docs/` is a course in this system, in the order the numbers actually flow —
one real capital call from spreadsheet to investor inbox. Start at
[docs/README.md](docs/README.md).

## How it is put together

```
src/engine/            the calculation. Pure, dependency-free, no I/O
src/adapters/workbook/ reads the accountant's .xlsx
src/adapters/storage/  CallRepository, and the row <-> model mapping
src/app/               Next.js routes
supabase/              migrations, pgTAP tests, local seed
```

Two ideas shape everything else.

**The engine is pure.** Same inputs, same numbers, no clock and no I/O. That is
what makes it safe to recompute on every keystroke, and what makes the
accountant's Expected_Output tab a regression test worth having.

**Issued calls are immutable.** A draft call stores only inputs and is
recomputed on demand. But once a notice reaches an investor, its figures are a
statement about a capital obligation, so sending the first notice locks the
call and freezes a snapshot. Correcting a mistake means issuing a new call, as
it does on paper. This is enforced by database triggers rather than application
code, because the service-role key bypasses row-level security and a bug in a
route handler would sail straight past a policy.

A related split: the **database owns structure** (types, keys, uniqueness,
immutability) and the **engine owns business rules**, reported as OK/WARN/FAIL
checks against inputs stored exactly as they were entered. Duplicating business
rules as CHECK constraints either blocked data entry half-finished or silently
corrected the accountant's typo.

`notices`, `call_results` and `audit_log` have read policies only. Recording a
notice as sent is an authority action that must originate server-side, or a
browser could approve its way past a failing tie-out check.

## Status

Done: the engine, the workbook parser, the schema, the storage layer, and all
three views — Home, Set up call, and the Call view with its Summary,
Allocation, Checks and Notices tabs. Notices can be approved and sent, which
freezes a snapshot and locks the call.

Not done: **Ask Axtara**, which needs an Azure AI Foundry endpoint, deployment
name and key before it can answer anything.

Also outstanding before this reaches real investors:

- Sending records the notice and freezes it, but does not yet deliver email.
  The prototype's `mailto:` needs to become a real provider with the PDF
  attached.
- The notice carries **no payment instructions**, as the design specified. No
  investor can wire against it as it stands.
- There is no way to invite a colleague: `client_members` has no insert policy,
  so adding one means running SQL.

## Known local quirks

Docker's clock drifts from the host after sleep, and PostgREST then rejects
freshly minted tokens with `JWT issued at future`. Restart the stack, or wait.

`npm install` can break Vitest's native binding (an npm optional-dependency
bug). The fix is `rm -rf node_modules package-lock.json && npm install`.

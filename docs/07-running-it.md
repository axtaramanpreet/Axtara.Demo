# Chapter 7 — Running it

The last chapter isn't about how the code works. It's about **keeping it
running**: where each piece lives, how a change gets to `fund.axtara.ai`, which
keys matter, and what to do when something breaks.

---

## 7.1 The five services

```
                      fund.axtara.ai
                           │   DNS record at your domain host (axtara.ai is on Emergent)
                           ▼
                ┌─────────────────────┐
                │  VERCEL             │   runs the Next.js app
                │  project axtara-fund│   pages, API routes, PDFs
                └──┬───────┬───────┬──┘
                   │       │       │
       ┌───────────┘       │       └────────────┐
       ▼                   ▼                    ▼
┌─────────────┐   ┌─────────────────┐   ┌──────────────┐
│ SUPABASE    │   │ MICROSOFT       │   │ RESEND       │
│ Postgres    │   │ FOUNDRY         │   │ email        │
│ + sign-in   │   │ Claude, for     │   │ notices go   │
│ (hosted)    │   │ Ask Axtara      │   │ out through  │
└─────────────┘   └─────────────────┘   └──────────────┘
```

| Service | Holds | If it's down |
|---|---|---|
| **Vercel** | the running app | the site is down |
| **Supabase** | every fund, call, notice; every login | the site loads but can't sign in or show anything |
| **Microsoft Foundry** | nothing, it just answers | Ask Axtara shows an error; everything else works |
| **Resend** | nothing, it just sends | sending still **issues** the notice; the email is recorded as failed (chapter 5 §5.4) |
| **Domain host** | the `fund` DNS record | `fund.axtara.ai` stops resolving; the `*.vercel.app` address still works |

Only Supabase holds data. Everything else can be replaced without losing
anything.

### Where each one runs, and why it matters

| | Region |
|---|---|
| Supabase | `ap-south-1`, **Mumbai** |
| Vercel's edge (static pages, the nearest cache) | `bom1`, Mumbai, the nearest to you |
| Vercel's **functions** (every page that reads data, every API route) | set by [vercel.json](../vercel.json): `"regions": ["bom1"]` |

The functions **must run next to the database.** A page asks the database
several times, one question after another. Until `vercel.json` set the region,
the functions ran in Vercel's default, `iad1`, **Washington DC**. Every question
crossed from the US to Mumbai and back:

```
measured on production, signed in, before the fix
  x-vercel-id: bom1::iad1::…      edge Mumbai, function Washington
  /  (redirect to your fund)      2.7 s
  Home                            3.6 – 4.4 s
  a call                          1.5 – 1.9 s
  one round trip, India → the database directly    0.13 – 0.17 s
```

The header `x-vercel-id` on any response shows it: `bom1::bom1::…` is right,
`bom1::iad1::…` means the functions have gone back to the US.

```bash
curl -sI https://fund.axtara.ai/login | grep -i x-vercel-id
```

(The login page is cached, so it only shows the edge. Check a signed-in page,
or the Network tab in the browser, to see the function region.)

---

## 7.2 Running it on your machine

Local is a **completely separate** copy. Your laptop runs its own Postgres in
Docker, with its own seeded demo data. Nothing you do locally touches
production.

```bash
# once
npm install

# each time
open -a Docker            # Docker Desktop must be running
npm run db:start          # starts local Supabase; first run downloads images
npm run db:reset          # builds the tables from the migrations + loads the seed
npm run dev               # http://localhost:3000
```

Sign in as **dev@axtara.local** / **password**. The seed gives you:

- *Illustrative Fund II* with Call No. 2 in progress, the chapter 1 fund
- *Illustrative Fund III* with no calls, to see the empty state

When you're done: `npm run db:stop`.

### How the app knows which database

`.env.local` (never committed, chapter 2 §2.5). Yours points at `127.0.0.1`,
the local one. Production's values live in **Vercel's** settings, not in any
file.

| Name | Public? | Is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | which Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | the key that only works with a signed-in user |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | skips every security rule |
| `ANTHROPIC_FOUNDRY_ENDPOINT` | secret | the Azure resource for Claude |
| `ANTHROPIC_FOUNDRY_KEY` | **secret** | bills your Azure account |
| `ANTHROPIC_FOUNDRY_MODEL` | secret | defaults to `claude-opus-5` |
| `RESEND_API_KEY` | **secret** | sends email as you |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | secret | how email is sent |
| `EMAIL_OVERRIDE_TO` | secret | **while set, every notice goes here instead of the investor** |
| `NOTICE_GP_NAME`, `NOTICE_SIGNATORY_NAME`, `NOTICE_SIGNATORY_TITLE` | secret | defaults for a new call's letter |

**`NEXT_PUBLIC_` means "put this in the browser".** Next.js copies those values
into the JavaScript every visitor downloads. Only the first two may have it.
Give the service-role key that prefix and anyone can read it off the page.

The full list of names, with no values, is in
[.env.example](../.env.example).

---

## 7.3 Before any deploy

```bash
npm run verify     # types + lint + all 444 tests
npm run build      # the production build, exactly as Vercel will run it
npm run db:test    # the 55 database tests (needs the local stack running)
```

Two catches:

- **`verify` and `build` check types differently.** `verify` includes the test
  files; `build` leaves them out. Run both.
- **Some tests skip when Docker is off.** The storage tests print a loud warning
  and skip. The summary still says passed. **Skipped isn't passed.**

There's **no CI**: no GitHub Action runs these for you. They only run when
someone runs them.

---

## 7.4 Deploying

Production is deployed **from your machine**, with the Vercel CLI:

```bash
npx vercel --prod
```

It isn't connected to GitHub, so pushing to `main` doesn't deploy anything, and
deploying doesn't need a push. What's live is whatever was on your disk when you
ran that command. Committed or not.

### What gets uploaded

[.vercelignore](../.vercelignore) decides. It leaves out `node_modules`,
`.next` (Vercel builds its own), the design handoff, `supabase/`, `samples/`,
`.git`.

Two lessons are written into that file:

- **Leaving out `.next` matters.** The first deploys uploaded 419 MB of local
  build output, and hung at "Initializing".
- **Leading slashes matter.** `supabase/` without the slash also matched
  `src/lib/supabase/`, which silently broke the build. `/supabase/` means "only
  the one at the top".

### The rule for this repo

**Commit and deploy only when the user says so.** Finish, check it locally,
report, and wait. It's in [CLAUDE.md](../CLAUDE.md).

### Undoing a deploy

Every deploy is kept. To go back:

```bash
npx vercel ls --prod        # list production deploys, newest first
npx vercel rollback         # back to the one before
```

**A rollback only undoes the app, never the database.** If a deploy came with a
migration (§7.5), rolling back the code leaves the new table shape in place.

---

## 7.5 Changing the database

Local and production each get migrations separately.

**Local:**

```bash
# write supabase/migrations/<timestamp>_<what>.sql
npm run db:reset           # rebuild local from every migration
npm run db:test
npm run db:types           # regenerate src/adapters/storage/database.types.ts
```

**Production**, when you mean it:

```bash
npx supabase db push       # applies new migrations to the linked hosted project
```

This repo is **linked** to the hosted project (`supabase/.temp/project-ref`), so
`db push` knows where to go.

The rules for writing one (chapter 2):

- **Never edit a migration that has already run.** Add a new one.
- **Deploy order:** push the migration **first**, then deploy code that needs
  it. The other way round, the new code runs against the old tables.
- **Except for a rename.** When a migration renames a table or column, the old
  app breaks the moment it lands, and the new app breaks until it does. There's
  no safe order: push and deploy back to back, when nobody is using the app, with
  the undo script ready (the client/fund rename's is in
  [supabase/rollback/](../supabase/rollback/)).
- There's no "down" migration. Undoing one means writing another.

### A fresh database

A new Supabase project has tables but **no one can sign in**. `clients` and
`client_members` have no insert policy, and there's no sign-up screen. So the
first client and user are made by hand, once:

[supabase/bootstrap/demo-user.sql](../supabase/bootstrap/demo-user.sql), pasted
into Supabase's SQL editor. It's deliberately **not** a migration: a migration
runs everywhere, and this makes one named person's account.

---

## 7.6 The domain

`fund.axtara.ai` is a DNS record on **the `axtara.ai` domain**, which is hosted
on Emergent, pointing at Vercel. Vercel issues the HTTPS certificate by itself.

```bash
npx vercel domains inspect fund.axtara.ai    # what Vercel expects, and whether it sees it
```

The code uses the domain name in one place: **share cards**.
[layout.tsx](../src/app/layout.tsx) sets
`metadataBase: new URL('https://fund.axtara.ai')` and the OpenGraph title
*"Axtara — AI-native fund administration"*. That's what a pasted link shows in
Slack or WhatsApp. Move to another domain and change it there too.

---

## 7.7 When it breaks

| You see | Usually | Do |
|---|---|---|
| `Missing NEXT_PUBLIC_SUPABASE_URL. Copy .env.example to .env.local…` | no `.env.local`, or a typo in a name | names are case-sensitive: `ANtHROPIC_…` was once the whole bug |
| `JWT issued at future` locally | Docker's clock drifted while the laptop slept | `npm run db:stop && npm run db:start` |
| Vitest fails to start after `npm install`, about a native binding | an npm bug with optional dependencies | `rm -rf node_modules package-lock.json && npm install` |
| React error **#418** in production only | a date printed without `timeZone: 'UTC'` (chapter 4 §4.8) | find the `toLocale…` call; use `fmtDate` or `fmtStamp` |
| A call you know exists is a 404 | RLS: that user's client doesn't own it | check `client_members` for that user |
| *"This capital call has been issued, so its inputs can no longer be changed"* | working as designed: the call is locked (chapter 2 §2.7) | raise a new call |
| *"3 checks are failing. Resolve them before approving notices."* | working as designed | the Checks tab says which |
| Ask Axtara says it isn't connected | `ANTHROPIC_FOUNDRY_ENDPOINT` or `_KEY` missing **in Vercel** | `npx vercel env ls` |
| Ask Axtara: *"could not answer — …"* | Foundry's own error, passed through | the text after the dash is Azure's |
| Notices "delivered" but no investor got one | `EMAIL_OVERRIDE_TO` is set, so they went to the test address | that's the safety catch working; clear it only on purpose |
| Email "failed: No email provider is configured" | `RESEND_API_KEY` or `EMAIL_FROM` missing | set both in Vercel |
| Deploy stuck at "Initializing" | uploading something huge | check `.vercelignore` |
| Build: *"Can't resolve '@/lib/supabase/server'"* | a `.vercelignore` rule without a leading `/` | `/supabase/`, not `supabase/` |

### Seeing what happened

- **App errors:** `npx vercel logs <deployment-url>`, or the Vercel dashboard.
  The notices route logs `notice action failed` with the real error.
- **Who did what:** the `audit_log` table (chapter 2). Every approve, undo and
  send, with who and which snapshot.
- **What an investor was told:** `notices.payload`, never today's screen
  (chapter 5 §5.7).

---

## 7.8 Honest gaps

**1. The production password is in git.** `demo-user.sql` creates
`demo@axtara.ai` with a password written in the file, and the file is in the
repo that's now on GitHub. The file says so itself, and says to change it
before real data. `fund.axtara.ai` is public, so anyone with that file can sign
in.

**2. Keys still to rotate.** These three passed through a chat session while
this was built: the Supabase **service-role key**, the **database password**,
and the **Foundry key**. Rotating means making a new one in that service,
putting it in Vercel (`npx vercel env`), redeploying, then deleting the old one.

**3. No CI.** §7.3. Nothing stops a deploy whose tests fail, except whoever runs
the deploy.

**4. Deploys don't check the database.** Nothing checks that production's
tables match what the code expects. Deploy code before its migration and you
find out from errors.

**5. No monitoring.** No error tracking and no alerts. If sending starts
failing at 2am, the first sign is someone noticing.

**6. The engine version on a CLI deploy is unchecked.** Chapter 2 §2.11, gap 4.
Worth one look at a real `call_results.engine_version`.

**7. There's no way to invite a colleague.** Every new user means editing and
re-running the bootstrap SQL (§7.5).

---

## 7.9 The whole system, on one page

```
the accountant's .xlsx                                      chapter 3
    │  read in the browser, SheetJS, never uploaded
    ▼
CallModel ──── save_call_inputs, all or nothing ────▶ Postgres   chapter 2
    │                                                  RLS: your client only
    ▼                                                  triggers: sent = frozen
compute()  pure; same numbers everywhere               chapter 1
    │  allocate → fee → offsets → roll-forward → checks → golden
    ├──▶ the screens            server draws, browser wakes it up     chapter 4
    ├──▶ Ask Axtara             whole fund as JSON → Claude → cited   chapter 6
    └──▶ approve / send         server re-checks, service key writes  chapter 5
            │
            ├──▶ call_results   the snapshot, with the engine version
            ├──▶ notices        the letter exactly as sent
            ├──▶ PDF + email    Resend, or the override address
            └──▶ audit_log      who, what, when
                                                         running it: chapter 7
```

That's all of it.

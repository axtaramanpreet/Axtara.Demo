# Chapter 2 — The data

Chapter 1 was the maths. This chapter is **where the numbers live, and who is
allowed to change them.**

The database is Postgres, hosted by Supabase. Everything about its shape is in
15 files in [supabase/migrations/](../supabase/migrations/). A **migration** is
a SQL file that changes the database one step. They run in date order, oldest
first, and never get edited after they've run. Each fix is a new file.

Each section below gives the rule first, then shows it on the same fund as
chapter 1.

---

## 2.1 The one idea everything hangs on

From the top of
[core_schema.sql](../supabase/migrations/20260917120000_core_schema.sql):

> a capital call's INPUTS are editable and recomputed on demand, but once a
> notice goes to an investor the numbers on it become a legal statement and are
> frozen.

So the tables come in two halves:

```
THE LIVE HALF (inputs)                THE FROZEN HALF (what was told)
────────────────────────              ────────────────────────────────
calls            the setup fields     call_results   snapshot of compute()
call_register    one row per LP       notices        one letter per LP
call_components  what's called        audit_log      who did what, when
call_fee_offsets fee rebates
call_transfers   LP → LP sales
call_expected_output  golden answers

edited all the time                   written once, never changed
the browser can write                 only the server can write
```

The answers from chapter 1 (each investor's share, fee, total) are **not
stored** while a call is a draft. They're worked out fresh every time the page
loads. There's nothing to keep in sync, so nothing can drift.

They're stored exactly once: at the moment of sending.

---

## 2.2 The tables

### Who owns what

```
firms              the fund administrator (Axtara's customer)
 └─ firm_members   which users belong to it, and their role
 └─ clients        a fund they administer ("client" in the UI = a fund)
     └─ investors  LP01, LP02… same investor across every call
     └─ calls      Call No. 1, Call No. 2…
         └─ call_register, call_components, call_fee_offsets,
            call_transfers, call_expected_output
         └─ call_results, notices
```

Every row belongs to exactly one firm, through this chain. That chain is what
the security rules in §2.4 follow.

### Why investors and the register are two tables

This is the one design choice worth slowing down on.

```
investors       WHO they are     name, type, email, side-letter ref
call_register   WHERE they stand commitment, paid-in, unfunded — for ONE call
```

LP01 is the same investor in Call 1 and Call 7. Their **name** is the same.
Their **balances** are different every call, because each call changes them.

So for our fund, Call No. 2:

```
investors       lp_id=LP01  lp_name=Alpha Pension Trust
                contact_email=treasury@alphapension.example

call_register   call=Call 2  investor=LP01
                commitment=10,000,000  opening_paid_in=2,000,000
                opening_ucc=8,000,000  status=Active
```

When Call 3 starts, its register carries forward Call 2's **closing** figures as
its **opening** ones (the chapter 1 formulas):

```
Call 3 opening_ucc      = Call 2 closing_UCC     = 6,635,983.06
Call 3 opening_paid_in  = Call 2 closing_paid_in = 3,393,719.91
```

That's [carry-forward.ts](../src/engine/carry-forward.ts). The investor row
itself doesn't move.

### Column names follow the spreadsheet

The rule is: take the workbook heading and write it in snake_case.

```
LP_ID        → lp_id
Opening_UCC  → opening_ucc
Total_Amount → total_amount
```

The spreadsheet, the engine and the database all use the same words. The
mappers in [mappers.ts](../src/adapters/storage/mappers.ts) do the rest:

| Workbook / engine | Database | Function |
|---|---|---|
| `'Y'` / `'N'` | `true` / `false` | `fromYesNo`, `toYesNo` |
| `"LP01, LP03"` | `{LP01,LP03}` (a text array) | `fromIdList`, `toIdList` |
| `"10,000,000"` | `10000000` | `toStoredAmount` (uses the engine's `num()`) |

### Money is never a float

```sql
create domain money_amount  as numeric(20, 4);   -- up to 4 decimal places, exact
create domain rate_fraction as numeric(12, 8);   -- 0.02 means 2%
```

`numeric` stores decimals **exactly**. A float stores them approximately. That's
the same problem the `1e-9` in chapter 1 fixes. The engine calculates, rounds to
the cent, and the database keeps that exact figure.

---

## 2.3 What the database checks, and what it leaves alone

The first version checked everything: allocation basis, transfer type, status,
due date after call date. That turned out to be wrong, and
[relax_input_validation.sql](../supabase/migrations/20260917120500_relax_input_validation.sql)
took most of it out. Its reasoning:

> type "Vibes" as an allocation basis, save, reload, and it now reads
> "Commitment" with no warning that anything was changed.

Either the typo got quietly corrected, or the save failed with a constraint name
nobody could read. Both are bad.

So the split is now:

```
THE DATABASE owns STRUCTURE           THE ENGINE owns BUSINESS RULES
─────────────────────────             ──────────────────────────────
types, keys, uniqueness               "is this basis real?"
3-letter currency code, if set        "is the due date set?"
rounding_decimals between 0 and 4     "does it tie to the cent?"
a status must carry its evidence      reported as ok / warn / fail
issued calls can't change             shown on the Checks tab
```

The rule: **a draft may have holes.** The accountant types things in over an
afternoon. The database stores exactly what they typed, mistakes included, so
the Checks tab can tell the truth about it. The engine's `fail` checks stop it
being **sent**, and that's the only point where "incomplete" matters.

Two checks the database does keep on notices, because a status that claims
something must be able to prove it:

```sql
constraint approved_has_timestamp
  check (status <> 'approved' or approved_at is not null)
constraint sent_has_evidence
  check (status <> 'sent' or (sent_at is not null and payload is not null
                              and result_id is not null))
```

In words: you can't mark a notice sent without the letter it was, the time it
went, and the snapshot it came from.

---

## 2.4 Who can see what: row-level security

**RLS** (row-level security) is a filter the database adds to every query by
itself. The app asks for "all calls". The database quietly answers "all calls
**you're allowed to see**". The app can't forget to filter, because it isn't
the app doing the filtering.

It's all in
[row_level_security.sql](../supabase/migrations/20260917120200_row_level_security.sql).

### Rule 1 — tenancy (who you are)

```
you → firm_members → your firms → their clients → their calls → everything under them
```

Built from small helper functions:

```sql
auth_firm_ids()    -- firms I belong to
auth_client_ids()  -- funds in those firms
auth_call_ids()    -- calls in those funds
```

Every read policy is one line using one of those:

```sql
create policy calls_read on calls
  for select to authenticated
  using (client_id in (select auth_client_ids()));
```

A user from another firm asking for our Call 2 gets **nothing back**. Not
"forbidden", just nothing. The app never even learns that the call exists.

### Rule 2 — roles (what you may do)

`firm_members.role` is one of four:

| Role | Read | Edit inputs |
|---|---|---|
| `owner` | ✓ | ✓ |
| `admin` | ✓ | ✓ |
| `preparer` | ✓ | ✓ |
| `viewer` | ✓ | ✗ |

`auth_can_write_firm()` is literally `role in ('owner', 'admin', 'preparer')`.

### Rule 3 — authority (what nobody can do from a browser)

This is the important one. Look at what's **missing**:

```sql
create policy notices_read on notices
  for select to authenticated
  using (call_id in (select auth_call_ids()));

-- …and no insert policy. No update policy. For call_results and audit_log too.
```

With RLS turned on, **no policy means no**. So no signed-in user, owner
included, can write a notice, a snapshot or an audit line from the browser.

Why: approving and sending tell an investor they owe money. If a browser could
write `status = 'sent'`, then a bug, or anyone editing requests in their dev
tools, could approve past a failing check or invent a notice. So those writes
are only possible for the server.

---

## 2.5 The three keys

[supabase-client.ts](../src/adapters/storage/supabase-client.ts) makes three
kinds of connection:

| Client | Key | Acts as | RLS | Used in |
|---|---|---|---|---|
| `createBrowserSupabase` | anon (public) | the signed-in user | **applies** | client components |
| `getServerSupabase` | anon (public) | the signed-in user, from their cookie | **applies** | server pages, `/api/ask` |
| `createServiceSupabase` | **service role** (secret) | nobody, it's all-powerful | **skipped** | `src/server/call-actions.ts` only |

The **anon key** is safe to put in the browser. On its own it can't do anything.
It only works together with a signed-in user's session, and then RLS limits it
to what that user may do.

The **service role key** skips every RLS rule. That's why:

- it's only used in one file, [call-actions.ts](../src/server/call-actions.ts)
- it must never have a `NEXT_PUBLIC_` prefix, because that would bake it into
  the JavaScript every browser downloads
- the client is built with sessions off, so it can never pick up a user's
  cookie and quietly act as them
- it's one of the keys that still needs rotating, because it passed through
  our chat

### How the server uses it safely

Having the all-powerful key means the server has to do the checking itself. The
rule in `call-actions.ts` is **check as the user, then write as the service**:

```
1. READ as the user   (getServerSupabase)
   → signed in?              no  → 401
   → can I see this call?    no  → 404  (RLS hid it)
   → auth_can_write_call?    no  → 403  (a viewer)

2. RECOMPUTE from what's stored
   → the browser only says WHICH investors. Never HOW MUCH.
   → compute(stored inputs) gives the figures

3. CHECK
   → any fail check?         yes → 409, refuse

4. WRITE as the service   (createServiceSupabase)
```

Step 2 matters most. The request body is only
`{ action: 'send', lpIds: ['LP01'] }`. There's no amount in it anywhere. Even a
tampered browser can't make LP01 owe a different number, because the server
works it out again from the database.

---

## 2.6 Freezing: what happens when you press Send

`sendNotices()` in [call-actions.ts](../src/server/call-actions.ts), in order:

```
1. checks pass?                          else refuse
2. only APPROVED notices go              you can't skip review
3. INSERT call_results                   the snapshot: totals, every row,
                                         every check, and engine_version
4. UPSERT notices → status='sent'        with payload = the letter as rendered
                                         and result_id = the snapshot from 3
5. ── a trigger fires: calls.locked_at = now() ──  the call is now LOCKED
6. email each notice                     separately, see §2.8
7. INSERT audit_log                      who, what, which snapshot
```

### `engine_version`

The snapshot stores the git commit of the code that did the maths. It reads
`VERCEL_GIT_COMMIT_SHA`, then `ENGINE_VERSION`, and falls back to `'dev'`. (We
deploy with the Vercel CLI rather than from GitHub. I haven't checked that
Vercel fills in the commit on a CLI deploy. If it doesn't, snapshots say `'dev'`.
See §2.11.) If a bug in `compute()` is found next year, you can
tell exactly which notices came from the buggy version, and what they said, even
though the code has changed since.

### `payload`

The notice is saved **as it was rendered**, not as "the inputs to render it
again". If the notice template changes next month, an old notice still reads
exactly the way the investor saw it.

---

## 2.7 Locking: the database says no

All in
[immutability.sql](../supabase/migrations/20260917120100_immutability.sql).

A **trigger** is a function the database runs by itself when a row changes. The
app doesn't call it and can't skip it.

### The lock goes on

```sql
-- after a notice becomes 'sent':
update calls set locked_at = now()
 where id = new.call_id and locked_at is null;
```

Only the **first** send sets it (`and locked_at is null`). Sending LP02 an hour
later doesn't move the timestamp.

### Then everything refuses

| Table | What's refused once locked |
|---|---|
| `call_register`, `call_components`, `call_fee_offsets`, `call_transfers`, `call_expected_output` | insert, update, delete |
| `calls` | update, delete |
| `call_results` | update, delete — **always**, locked or not |
| `notices` (sent) | changing `payload`, `sent_at`, `result_id`, `sent_to_email`, and moving the status away from `sent` ([sent_is_final.sql](../supabase/migrations/20260923120000_sent_is_final.sql)) |
| `audit_log` | update, delete — **always** |

The error has a code, `23001` (Postgres's name for it is `restrict_violation`).
[supabase-repository.ts](../src/adapters/storage/supabase-repository.ts)'s
`asError()` turns that into:

> This capital call has been issued, so its inputs can no longer be changed.
> Raise a new call to correct it.

That's how it works on paper too. You don't edit a sent capital call. You issue
a correcting one.

### Why a trigger, not app code

From the migration:

> application rules are one refactor away from being bypassed, and because the
> service-role key sidesteps row-level security entirely. Triggers do not.

RLS stops the browser. But the server has the service key, which skips RLS. So
if a future server bug tried to edit an issued call, RLS wouldn't catch it. The
trigger would. **Triggers run for everyone, service key included.**

That makes two walls:

```
RLS       stops the BROWSER from writing what only the server should
TRIGGERS  stop EVERYONE, server included, from rewriting history
```

---

## 2.8 Sent vs delivered: two different things

[notice_delivery.sql](../supabase/migrations/20260919090000_notice_delivery.sql)
gives email its own columns:

```
status         'sent'       ← the fund ISSUED it. Permanent.
email_status   'delivered'  ← the email ARRIVED. Or 'failed', or 'pending'.
```

Why split them? Say an email bounces. If "sent" and "delivered" were the same
field, you'd have two bad options:

- leave it "sent", and the record claims an investor was told something they
  never got
- re-issue the call to try again, which is impossible because issuing is
  permanent

With two fields, delivery can fail and be retried as many times as needed
without touching one figure. The immutability trigger only freezes `payload`,
`sent_at`, `result_id` and `sent_to_email`, so the `email_*` columns stay
editable on purpose.

`email_delivered_to` records where it **actually** went. While
`EMAIL_OVERRIDE_TO` is set, every notice goes to one test address, and the
record shows that rather than pretending the investor was contacted.

---

## 2.9 Saving all at once: `save_call_inputs`

[save_call_inputs.sql](../supabase/migrations/20260917120400_save_call_inputs.sql)

The problem: saving a call touches 6 tables. Six separate requests means that if
request 4 fails, you're left with a new register and old components. The
engine would compute that happily, and the answer would be wrong.

The fix: one database function, called with one `rpc()`. A function runs as
**one transaction**. A transaction is all-or-nothing: either every change lands
or none do.

Inside it, roughly:

```
update calls           the setup and fee fields
upsert investors       names and emails (shared across calls)
delete + insert        call_register      for THIS call
delete + insert        call_components
delete + insert        call_fee_offsets
delete + insert        call_transfers
delete + insert        call_expected_output
```

Two details:

- **Investors are upserted, not replaced.** (Upsert means insert it, or update
  it if it's already there.) Fix LP01's email on Call 7 and it's fixed for the
  investor everywhere. Their balances belong to Call 7 only.
- **A blank is an answer.** For a field that may be empty, a key sent as
  `null` clears it; a key left out keeps its value. Until
  [save_every_setup_field.sql](../supabase/migrations/20260925100000_save_every_setup_field.sql),
  every field kept its old value on `null`, so blanking a due date was undone on
  reload, and GP name and signatory weren't saved at all.
- **It runs as the caller** (`SECURITY INVOKER`, the default). So RLS and the
  lock triggers still apply inside it. It makes saving atomic; it isn't a way
  round the rules. Save into a locked call and the first `delete` hits the
  trigger, so the whole save rolls back.

The browser calls it from `saveCall()` in
[supabase-repository.ts](../src/adapters/storage/supabase-repository.ts),
800 ms after the last keystroke.

---

## 2.10 The views: questions the database answers

A **view** is a saved query you can read like a table.
[derived_views.sql](../supabase/migrations/20260917120300_derived_views.sql)
has three, plus a fix in
[position_paid_in.sql](../supabase/migrations/20260917120600_position_paid_in.sql).

All three use `security_invoker = on`. Without that, a view reads with its
**owner's** rights, not yours, and quietly becomes a way to see other firms'
data. With it, RLS applies as if you'd queried the tables yourself.

### `call_stages` — the status tag on each call

The stage is **worked out, never stored**, so it can't disagree with the
notices it comes from.

```
FORMULA
  not_started     if  active investors = 0  AND  components = 0
  issued          if  active investors > 0  AND  sent ≥ active investors
  partially_sent  if  sent > 0
  in_progress     otherwise
```

(Checked top to bottom. The first one that matches wins.)

Our Call 2: 6 active investors, 5 components, 0 sent → `in_progress`.
Send LP01 → `partially_sent`. Send all 6 → `issued`.

### `call_latest_result` — the newest snapshot per call

```sql
select distinct on (call_id) … order by call_id, computed_at desc
```

"For each call, keep only the newest row."

### `client_positions` — the Fund position card on Home

```
FORMULA
  total_commitments          = Σ commitment       ┐ from the register of the
  paid_in_capital            = Σ opening_paid_in  │ NEWEST CALL THAT HAS ONE
  unfunded_commitment        = Σ opening_ucc      │ (at least one active LP),
  investors                  = count              ┘ active LPs only

  called_to_date             = Σ snapshot.total    ┐ from ISSUED (locked)
  called_against_commitment  = Σ snapshot.reduces  ┘ calls only
```

Our fund, before Call 2 is sent:

```
total_commitments    = 50,500,000
paid_in_capital      =  9,800,000
unfunded_commitment  = 40,700,000     ← and 50,500,000 − 9,800,000 = 40,700,000 ✓
called_to_date       =          0     ← nothing issued yet
```

That's why the card says **"before Call No. 2"**. It reads Call 2's opening
balances.

The fix migration explains why unfunded comes from the register and not from
"commitments minus what we called": the fund already had 9.8m paid in before
this system existed. The first version ignored that and showed all 50.5m as
still unfunded.

**Why "that has one".** It used to read the newest call, full stop. A new call
starts empty, so pressing *New capital call* made the card read an empty
register: every line 0.00, and the chart saying *"27.9% of USD 0"*.
[position_from_set_up_call.sql](../supabase/migrations/20260924090000_position_from_set_up_call.sql)
skips calls with no active investor yet, and `latest_call_no` names the call the
figures came from. Tested in
[client_positions.test.sql](../supabase/tests/client_positions.test.sql).

Draft calls are left out of `called_to_date` on purpose. Their figures aren't
stored (§2.1), so only money that was actually called gets counted.

---

## 2.11 Honest gaps

I found these while writing this chapter. None of them is fixed.

**1. The role comment and the code disagree.** `core_schema.sql` says:

```sql
-- preparer may build and approve calls; only admin and owner may send.
```

But `sendNotices()` only checks `auth_can_write_call`, which lets `preparer`
through. **Today a preparer can send.** One of the two is wrong, and it's your
call which.

**2. Sending isn't one transaction.** Steps 3 and 4 in §2.6 are two separate
writes. If step 3 (the snapshot) works and step 4 (the notices) fails, you're
left with a snapshot that no notice points to. It can never be deleted, because
snapshots are immutable. The harm is small: the call isn't locked, so Home
doesn't count it, and the next successful send makes a newer snapshot. But in
that case the route's catch-all message, *"Nothing was changed"*, isn't true.

**3. The audit write doesn't check for errors.** `audit()` inserts and never
looks at the result. If it fails, the send still succeeds, with no audit line.

**4. The engine version may not be recorded.** See §2.6. It's unchecked on a
CLI deploy. Worth one look at a real snapshot before this matters.

**5. Nobody can add a colleague.** `firm_members` has a read policy and no insert
policy, so inviting a user means running SQL by hand. (The README says this
too.)

---

## 2.12 Do it yourself

Both of these were run against the local database while writing this chapter.

### Watch the database refuse

```bash
npm run db:start
npm run db:test
```

`db:test` runs 62 **pgTAP** tests (tests written in SQL, run inside the
database) from [supabase/tests/](../supabase/tests/). All 62 pass. Open
[immutability.test.sql](../supabase/tests/immutability.test.sql) next to the
output. It sends a notice, then tries to edit the register:

```sql
select throws_ok(
  $$ update call_register set commitment = 99999999 where … $$,
  '23001',
  null,
  'the register cannot be edited after a notice has been sent'
);
```

`throws_ok` means "this must fail, with error code 23001". The test passes when
the database **refuses**.

### Look at the stage view yourself

`psql` isn't installed on your Mac, so this runs it inside the database's own
Docker container:

```bash
docker exec -it supabase_db_Axtara.Fund psql -U postgres -d postgres
```

```sql
select call_no, active_investors, components, notices_sent, stage
  from call_stages
 where call_id = '00000000-0000-4000-8000-0000000000a2';
```

That's the seeded Call 2 from §2.10. You get:

```
 call_no | active_investors | components | notices_sent |    stage
---------+------------------+------------+--------------+-------------
       2 |                6 |          5 |            0 | in_progress
```

This connects as `postgres`, the database superuser, so **RLS doesn't apply**
here. You'll see every firm's data. That's the view the service role key gets,
and it's why that key is dangerous. `\q` to leave.

---

## What's in this chapter's files

| File | Does |
|---|---|
| [core_schema.sql](../supabase/migrations/20260917120000_core_schema.sql) | every table |
| [immutability.sql](../supabase/migrations/20260917120100_immutability.sql) | the lock and the refusals |
| [row_level_security.sql](../supabase/migrations/20260917120200_row_level_security.sql) | who sees what, who writes what |
| [derived_views.sql](../supabase/migrations/20260917120300_derived_views.sql) | stages, latest snapshot, fund position |
| [save_call_inputs.sql](../supabase/migrations/20260917120400_save_call_inputs.sql) | the all-or-nothing save |
| [relax_input_validation.sql](../supabase/migrations/20260917120500_relax_input_validation.sql) | database = structure, engine = rules |
| [position_paid_in.sql](../supabase/migrations/20260917120600_position_paid_in.sql) | fund position fixed to use the register |
| [notice_delivery.sql](../supabase/migrations/20260919090000_notice_delivery.sql) | sent ≠ delivered |
| [sent_is_final.sql](../supabase/migrations/20260923120000_sent_is_final.sql) | a sent notice can't be moved out of `sent` (chapter 5 §5.9) |
| [position_from_set_up_call.sql](../supabase/migrations/20260924090000_position_from_set_up_call.sql) | fund position reads the newest call that has a register (§2.10) |
| [save_every_setup_field.sql](../supabase/migrations/20260925100000_save_every_setup_field.sql) | GP name and signatory are saved, and a blanked field stays blank (§2.9) |
| the other 4 migrations | small additions: delete an empty fund, optional setup fields, GP name, signatory |
| [supabase-client.ts](../src/adapters/storage/supabase-client.ts) | the three clients |
| [supabase-repository.ts](../src/adapters/storage/supabase-repository.ts) | every read, and the one save |
| [mappers.ts](../src/adapters/storage/mappers.ts) | row ↔ `CallModel` |
| [call-actions.ts](../src/server/call-actions.ts) | approve, revert, send |

**Next:** Chapter 3, the workbook. What happens to the `.xlsx` between upload
and the screen.

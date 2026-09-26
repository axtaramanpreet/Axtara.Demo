# Design 1 — The fund, its register, and the ledger

**Status:** §3.1 (`fund_terms`) is **built** on branch `feat/fund-ledger`: the
table, the engine's `termsOn`, the Settings page (searchable currency, investor
pickers, suggested defaults, the fee after the investment period as a scheduled
dated row), and new calls pre-filling from the terms in force.

§3.2 is **built differently from this note**: commitments live on closings
(`closings` + `closing_commitments`, dated by the closing that admitted them),
not in a free-standing `commitments` table, because a commitment only ever
arrives at a close. Equalization and true-ups are built on top (migration
`20260926090000_closings_and_fee_runs.sql`; fee runs were later dropped for the
billed calls, `20260927140000`; engine
`equalization.ts`, `fee-run.ts`, `fund-history.ts`, `fund-register.ts`).

§4, the `ledger_entries` table, is **not built**. Positions and fees are worked
out from the record each time instead (`positionsOn`, `feeLedgerFor`). A ledger
is still the right end state — it belongs to the .NET rebuild.

**Names:** written after the rename in
[client_above_fund.sql](../../supabase/migrations/20260925110000_client_above_fund.sql):
`clients` is the top level (a GP or manager), `funds` sit under it.

**Covers:** steps 1 and 2 of the plan. These are the foundation that Closings,
Equalization and the management fee (with true-ups) all stand on. Steps 3 to 5
get their own notes when we reach them.

---

## 1. The problem, in one table

Today the capital call is the only real thing. Everything a fund *is* lives
inside each call, copied every time:

| Fact | Lives today | Should live |
|---|---|---|
| Fund terms (currency, fee, rounding, GP, signatory) | columns on **every** `calls` row | the **fund**, once, dated when it changes |
| An investor's commitment | `call_register.commitment`, **per call** | the **fund**, added by a closing |
| Paid-in, unfunded | `call_register.opening_*`, **typed or carried forward** | **added up** from a ledger of what happened |
| What fee was charged, for which period | nowhere after the call is sent, except inside a frozen snapshot | a **ledger line** with period, basis and rate |

Closings, equalization and fee true-ups all need the right-hand column.

---

## 2. Rules for this work, so the demos are safe

1. **Additive only.** New tables. **No existing table loses or changes a
   column.** No existing view changes meaning.
2. **Existing calls keep working exactly as now.** A call still stores its own
   copy of the terms and register it used. That copy is the record of what that
   call was. The new tables only *pre-fill* new calls.
3. **Built and tested against the local database only.** Nothing from this
   branch is pushed to production's database until it's merged and agreed.
4. **No production deploy from this branch.** Deploys are from `main`.
   (Previews may use the production database too, so no previews either; see
   §7.)
5. **Shadow before switch.** When the ledger starts giving opening balances, it
   runs *alongside* today's carry-forward first. Any difference shows up as a
   check. We switch only once they agree on every real call.

---

## 3. Step 1 — the fund and its register

### 3.1 `fund_terms`: the fund's settings, dated

```
fund_terms
  id                uuid
  fund_id           → funds
  effective_from    date          the terms apply from this date
  reporting_currency, rounding_decimals, rounding_plug_lp_id
  fee_basis, fee_rate_annual, fee_period_fraction, fee_reduces_unfunded
  fee_exempt_lp_ids
  gp_name, signatory_name, signatory_title
  org_expense_cap

  -- LPA terms. Every fund sets its own; see §6.
  fee_timing                 'advance' | 'arrears'
  fee_day_count              'period_fraction' | 'actual_365' | 'actual_360' | '30_360'
  late_close_interest_rate   rate_fraction       null = no interest on catch-ups
  late_close_interest_basis  'simple' | 'compound'
  catch_up_fee_to            'gp' | 'existing_lps'
  equalization_interest_to   'existing_lps' | 'fund' | 'gp'

  created_at, created_by
```

- **Never updated, only added to.** Changing the fee rate from 2% to 1.5% from
  1 Jan adds a row with `effective_from = 1 Jan`. The terms on a given date are
  the latest row on or before it.
- That's what makes a later true-up possible: "what was the rate on 15 March?"
  always has an answer.
- A **new call** copies the terms in force on its call date into its own
  columns, as today. The accountant can still override them on that call.

### 3.2 `commitments`: who promised what, and when

```
commitments
  id                uuid
  fund_id           → funds
  investor_id       → investors
  amount            money_amount      positive = new or increased, negative = reduced
  effective_date    date
  reason            'closing' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'opening'
  closing_id        → closings (step 3; null until then)
  note, created_at, created_by
```

- Also **add-only.** An investor's commitment on a date is the **sum** of their
  rows up to that date.
- `'opening'` is for funds that existed before Axtara. One row per investor
  gives the commitment they arrived with.
- Transfers already exist in the engine. Later, applying one can post a
  `transfer_out` and `transfer_in` pair.

### 3.3 What the screens get

The sidebar already has **Investors** and **Settings**, both "not built yet".

- **Settings** → the fund's terms, with their history.
- **Investors** → every investor, their current commitment, and (after step 2)
  their paid-in and unfunded, added up.
- **New capital call** → pre-filled from these, so nobody retypes the fund's
  terms or register again.

---

## 4. Step 2 — the ledger

### 4.1 `ledger_entries`: every money movement, one line each

```
ledger_entries
  id                  uuid
  fund_id             → funds
  investor_id         → investors
  effective_date      date

  kind                'contribution'     a component called (a deal, an expense)
                      'mgmt_fee'         gross management fee
                      'fee_offset'       offset against it (negative)
                      'equalization'     step 4
                      'fee_true_up'      step 5
                      'opening_balance'  history from before Axtara
                      'reversal'         cancels one earlier line

  amount              money_amount
  reduces_unfunded    boolean            inside or outside commitment

  -- What it was for. Filled where it applies.
  call_id             → calls            the call that posted it
  result_id           → call_results     the frozen snapshot it came from
  component_id        text               which component, for 'contribution'

  -- For fees, and any line a true-up may need to recompute later.
  period_start        date
  period_end          date
  basis_kind          'Commitment' | 'Invested_Capital' | …
  basis_amount        money_amount       the figure the fee was worked out on
  rate                rate_fraction

  reverses_id         → ledger_entries   for 'reversal'
  created_at, created_by
```

### 4.2 The rules

- **Append-only, enforced by trigger**, like `audit_log` today. No line is ever
  edited or deleted. A mistake is corrected by a `reversal` line plus a new
  line.
- **Written only by the server**, like `notices`. The browser gets a read
  policy and nothing else.
- **Balances are sums**, never typed:

```
paid_in(LP, date)   = Σ amount                         for LP, effective_date ≤ date
unfunded(LP, date)  = commitment(LP, date)
                    − Σ amount where reduces_unfunded  for LP, effective_date ≤ date
```

### 4.3 Why each fee line records its period, basis and rate

This is what makes **management fee true-ups** possible later (step 5).

```
true-up(LP, period) =  fee they SHOULD have paid        ← engine, from terms + commitments + history
                     − Σ mgmt_fee lines for that period  ← ledger
```

If a fee line only stored its amount, the second half could never be worked
out. So the fee line stores what it was worked out **on**. That's the one
decision in this note that can't be fixed later.

### 4.4 When lines are written

When a call is **sent**. The same moment its snapshot is frozen, and from the
same figures:

| Per investor, from the snapshot row | Line |
|---|---|
| each component share | `contribution`, with `component_id` and that component's `reduces_unfunded` |
| gross fee | `mgmt_fee`, with period, basis, rate |
| offset | `fee_offset`, negative |

**Sending must become one transaction.** Today, send writes the snapshot, then
the notices, as two separate steps (chapter 2 §2.11, gap 2). Adding ledger lines
as a third step would make that worse. So as part of this step, the snapshot,
the notices and the ledger lines move into **one database function**, the same
way `save_call_inputs` already works. Either all of it lands, or none of it
does.

### 4.5 History that already exists

For each fund already in the system:

1. an `opening_balance` line per investor, from their **first** call's
   register (`opening_paid_in`), dated before that call
2. `commitments` rows of kind `'opening'`, from the same register
3. for each **issued** call, the lines from its frozen snapshot, exactly as in
   §4.4

This is a **one-off script**, run locally first and compared call by call. It
only reads existing tables and only writes the new ones.

**One honest limit:** today's calls store the fee period only as a fraction
(`0.25`), not as dates. Backfilled fee lines will have `period_start` and
`period_end` **empty**, unless someone supplies the dates. So automatic true-ups
will only work on fees charged after the ledger exists, or on old ones once
their dates are filled in.

---

## 5. How it switches over, without breaking anything

```
phase A   new tables exist; nothing reads them            ← safe to push
phase B   sending also writes ledger lines                ← one transaction
phase C   SHADOW: a new call's opening balances are worked out BOTH ways
          (carry-forward, as now, and from the ledger); any difference
          is a WARN check naming the investor and the gap
phase D   ledger is the source; carry-forward stays only as the fallback
          for a fund with no ledger yet
```

Each phase ships on its own, and phases A to C change nothing an accountant sees
except, in C, a warning if the two ever disagree.

---

## 6. LPA terms are settings, per fund

Every fund's LPA (its legal agreement) sets these differently. So none of them
is written into the engine. Each is a column on `fund_terms` (§3.1), filled in
per fund, and the engine reads it.

| Setting | Choices | Default for a new fund | Used by |
|---|---|---|---|
| `fee_timing` | billed in **advance** or in **arrears** | `advance` | step 5, fee periods |
| `fee_day_count` | `period_fraction` (today's `0.25` a quarter), `actual_365`, `actual_360`, `30_360` | `period_fraction`, so existing calls work out exactly as now | step 5, part-periods and true-ups |
| `late_close_interest_rate` | a rate, or empty for none | empty | step 4, equalization |
| `late_close_interest_basis` | `simple` or `compound` | `simple` | step 4 |
| `catch_up_fee_to` | the **GP**, or shared back to the **existing investors** | `gp` | step 4 and 5 |
| `equalization_interest_to` | the **existing investors**, the **fund**, or the **GP** | `existing_lps` | step 4 |

**Changes over a fund's life** need no extra setting. Because `fund_terms` is
dated (§3.1), "the fee switches from commitment to invested capital after the
investment period" is just a new row with a new `fee_basis`, effective from
that date. The same goes for fee step-downs. The engine asks "what were the
terms on this date?" and gets the right answer for any period.

**Defaults are placeholders, not advice.** A fund's settings should be filled in
from its LPA when it's set up. The Settings screen should show which ones are
still on their default, so nobody assumes they were chosen.

## 7. Risks, and what contains each

| Risk | Contained by |
|---|---|
| A migration from this branch reaches production's database | nothing is `db push`ed from this branch; only after merge, and only additive tables (§2) |
| A deploy from this branch replaces production | no `vercel --prod` from this branch; the CLI deploys whatever is on disk, so switch to `main` first |
| A **preview** deploy writes to production data | Vercel's preview settings may point at the production database (they're hidden, so unconfirmed); no previews from this branch, or give previews their own Supabase project |
| Ledger and carry-forward disagree | shadow phase (§5, C) shows every difference before anything relies on the ledger |
| Backfill gets history wrong | run locally, compared call by call with the frozen snapshots, before it goes anywhere near production |
| Send leaves half-written state | send becomes one transaction as part of step 2 (§4.4) |

---

## 8. Not in this note

- **Closings** (step 3), **equalization** (step 4), **management fee as its own
  event, with true-ups** (step 5). This note only makes sure the tables they
  need will exist, with the right columns.
- **Distributions.** The ledger's `kind` list can grow to include them.

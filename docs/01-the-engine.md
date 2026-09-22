# Chapter 1 — The engine

`src/engine/` is the part that does the arithmetic. Everything else in this
repo exists to feed it or to display what it said.

It is a **pure function**. Pure means: same input, same output, always. No
database. No network. No clock. No random. Call it a thousand times with the
same numbers and you get the same answer a thousand times.

That one property buys three things:

- it can run on **every keystroke** in the setup screen, so figures update live
- it can be **tested to the cent** against the accountant's own spreadsheet
- when a number is wrong, the bug is **in one file**, not spread across the app

The whole calculation is [compute.ts](../src/engine/compute.ts), 464 lines, one
exported function:

```ts
export function compute(model: CallModel): ComputeResult
```

---

## 1.1 What goes in — `CallModel`

Five parts. Defined in [types.ts](../src/engine/types.ts).

| Part | Is | Example |
|---|---|---|
| `setup` | Facts about the fund and this call | fund name, call date, due date, currency, rounding |
| `lps` | The register — one row per investor | commitment, paid-in so far, unfunded left |
| `components` | What is being called for | "Deal X, 3,000,000" |
| `fee` | The management fee and any offsets against it | 2% a year, quarter period |
| `transfers` | Investors selling their stake to someone else | "LP05 sells 40% to a new LP06" |

Plus one optional part, `golden` — see §1.9. It is the accountant's own answer,
carried alongside the inputs so the engine can be marked against it.

### A cell is not a number

Every field is typed `Cell`, which is `string | number | null`. That is
deliberate. This data comes out of Excel, where a human typed it. `"1,500,000"`,
`" 2% "` and `"$500"` are all real things people put in cells.

So nothing reads a field directly. Everything goes through `num()` in
[format.ts](../src/engine/format.ts#L18):

```ts
export function num(v: Cell): number {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[,\s%$]/g, ''));
  return isNaN(n) ? 0 : n;
}
```

Strip commas, spaces, percent signs, dollar signs. Unparseable becomes `0`, not
`NaN`. That matters: in JavaScript `NaN` is contagious — one bad cell would turn
an entire allocation into `NaN` silently. A zero is wrong in an obvious way; a
`NaN` is wrong in an invisible way.

---

## 1.2 The fund we will follow

[illustrative-fund.ts](../src/engine/fixtures/illustrative-fund.ts). Six
investors. Real numbers from the accountant's template.

| | Investor | Commitment | Paid in | Unfunded (UCC) | Note |
|---|---|---:|---:|---:|---|
| LP01 | Alpha Pension Trust | 10,000,000 | 2,000,000 | 8,000,000 | |
| LP02 | Beta University Endowment | 7,500,000 | 750,000 | 6,750,000 | |
| LP03 | Gamma Family Office | 5,000,000 | 2,000,000 | 3,000,000 | side letter: fee 1% |
| LP04 | Delta Insurance Co | 15,000,000 | 1,500,000 | 13,500,000 | biggest; rounding plug |
| LP05 | Epsilon Sovereign Fund | 12,500,000 | 3,500,000 | 9,000,000 | |
| GP01 | Fund GP LLC | 500,000 | 50,000 | 450,000 | GP; pays no fee |
| | **Total** | **50,500,000** | 9,800,000 | 40,700,000 | |

**UCC** = unfunded committed capital. The money an investor has promised but not
yet sent. Commitment − paid in.

Being called for:

| Component | Amount | Split on | Reduces unfunded? |
|---|---:|---|---|
| Deal X | 3,000,000 | Commitment | Yes |
| Deal Y | 2,000,000 | Commitment | Yes |
| Deal Z | 1,500,000 | **UCC** | Yes |
| Partnership Expense | 200,000 | Commitment | Yes |
| Organizational Expense | 150,000 | Commitment | **No** |

Plus a management fee of 2% a year for a quarter (0.25), on commitment, with a
50,000 offset against it. Total called comes to **7,037,500**.

---

## 1.3 The order of operations

From the comment at the top of [compute.ts](../src/engine/compute.ts#L8):

```
1. Apply transfers      — settle who is in the fund and with what balances
2. Allocate components  — split each deal/expense pro-rata to its basis
3. Compute the fee      — per-LP rate, then offsets against it
4. Roll forward         — per-LP totals and closing balances
5. Tie out              — checks, including against Expected_Output
```

The order is not a style choice. Transfers change who is on the register, so
they must settle before anything is split. The fee is computed **after**
components because an offset is measured against the gross fee, not against the
call.

---

## 1.4 Step 0 — is this even a call?

Before any maths, four questions. [compute.ts:96](../src/engine/compute.ts#L96)

| Missing | Result |
|---|---|
| `Fund_Name` | **fail** — the notice would have no fund on it |
| `Call_Date` | **fail** |
| `Payment_Due_Date` | **fail** — nobody would know when to wire |
| `Reporting_Currency` | **warn** — falls back to USD, still readable |

A **fail** does not stop the calculation. It gets recorded as a check, and a
failing check blocks approval later. You can build a half-finished call all
afternoon; you cannot send one.

A **warn** is a thing worth seeing that is not wrong.

---

## 1.5 Step 1 — transfers

[transfers.ts](../src/engine/transfers.ts). An investor sells part of their
position to someone else. The engine settles that **before** allocating, so the
call is split across who actually owns the fund on the call date.

Our fixture has one, dated `2026-12-31`, against a call dated `2026-09-30`. It
is in the future, so it is reported but not applied:

```
info: Transfer T1 not applied — effective 31 December 2026, after call date.
```

Not silently ignored. Said out loud, in the checks.

---

## 1.6 Step 2 — components, and the one function that matters

Each component is split across the investors in proportion to a **basis** —
commitment, unfunded, or invested capital.

**The formula.** One line, and it is the same one for every component in the
system:

```
                        basis(LP)
share(LP) = round(  total × ───────────────── ,  d )
                        Σ basis(everyone)
```

- `total` — the component amount
- `basis(LP)` — that investor's commitment, or unfunded, or invested capital
- `Σ basis(everyone)` — the same figure summed over every participant
- `d` — decimal places (2 here)

### Deal X, split on Commitment

```
FORMULA   share = round( total × commitment(LP) / Σ commitments , 2 )

LP01      share = round( 3,000,000 × 10,000,000 / 50,500,000 , 2 )
                = round( 594,059.405940… , 2 )
                = 594,059.41
```

The engine produces exactly `594059.41`. The accountant's spreadsheet says
`594059.41`.

### Deal Z, split on UCC instead

Same formula. Swap `commitment` for `UCC` and both halves of the fraction
change — LP01's numerator, and the denominator for everybody:

```
FORMULA   share = round( total × UCC(LP) / Σ UCC , 2 )

LP01      share = round( 1,500,000 × 8,000,000 / 40,700,000 , 2 )
                = round( 294,840.294840… , 2 )
                = 294,840.29
```

`Σ commitments` was 50,500,000. `Σ UCC` is 40,700,000. Different denominator,
different answer, same line of code.

Notice what that does: **LP03 pays less of Deal Z than of Deal X**, because they
have already paid in a lot and have little unfunded left. That is the entire
point of having a basis per component.

### The rounding plug — the important bit

Round six shares independently and they almost never add back to the total. You
call for 3,000,000 and allocate 2,999,999.98. Two cents missing.

You cannot smear it. Smearing is non-deterministic and impossible to reconcile
next quarter.

So [allocate.ts](../src/engine/allocate.ts#L67) does this: five investors get
their rounded share. One investor — the **plug** — gets *whatever is left*.

```ts
const others = parts.filter((p) => p.id !== plug.id)
                    .reduce((s, p) => s + out[p.id], 0);
out[plug.id] = round(total - others, d);
```

```
FORMULA   everyone except the plug:   share  = round( total × basis / Σ basis , d )
          the plug:                   share  = round( total − Σ everyone else , d )
```

The plug's line has **no fraction in it**. That is the whole trick.

Here the plug is LP04, set in the fixture as `Rounding_Plug_LP_ID`. Deal X:

```
LP01  594,059.41
LP02  445,544.55
LP03  297,029.70
LP05  742,574.26
GP01   29,702.97
      ──────────
      2,108,910.89   ← Σ everyone else

LP04 = round( 3,000,000.00 − 2,108,910.89 , 2 ) = 891,089.11
```

LP04 is not given a share. LP04 is given the **remainder**.

It ties to the cent, every time, and always in the same place. The engine says
so in a check:

```
ok: Deal X ties: allocated 3,000,000.00 vs called 3,000,000.00 (residual to LP04).
```

If no plug is configured, it picks the **largest investor by basis** — a cent
lands least visibly on the biggest ticket.

If the basis sums to zero (nobody participating, or everyone at zero), it does
**not** divide by zero. It returns zeros and `ok: false`, and the caller raises
a failing check. [allocate.ts:50](../src/engine/allocate.ts#L50)

---

## 1.7 Step 3 — the fee, then offsets against it

```
FORMULA   gross_fee(LP) = round( basis(LP) × rate(LP) × period , d )
```

- `basis(LP)` — commitment here, but can be invested capital
- `rate(LP)` — annual rate, **per investor** (see the three rules below)
- `period` — fraction of a year. `0.25` = one quarter

Three rules, in this order of precedence
([compute.ts:230](../src/engine/compute.ts#L230)):

1. **Exempt beats everything.** Flagged `Fee_Exempt: 'Y'`, or named in
   `Fee_Exempt_LP_IDs` → rate is 0.
2. **A side-letter override beats the fund default.**
3. Otherwise the fund default.

A blank or zero override means "no override", **not** "0%". Only the exempt flag
means zero.

| | Basis | × Rate | × Period | = Gross fee |
|---|---:|---:|---:|---:|
| LP01 | 10,000,000 | 0.02 | 0.25 | 50,000.00 |
| LP02 | 7,500,000 | 0.02 | 0.25 | 37,500.00 |
| LP03 | 5,000,000 | **0.01** ← side letter | 0.25 | 12,500.00 |
| LP04 | 15,000,000 | 0.02 | 0.25 | 75,000.00 |
| LP05 | 12,500,000 | 0.02 | 0.25 | 62,500.00 |
| GP01 | 500,000 | **0** ← exempt | 0.25 | 0.00 |
| | | | | **237,500.00** |

Worked out longhand, LP03:

```
gross_fee(LP03) = round( 5,000,000 × 0.01 × 0.25 , 2 ) = 12,500.00
```

### The offset

The GP received a 50,000 transaction fee and shares it back. It runs through
the **same `allocate()` function** as a component — the only thing that changes
is what goes in the `basis` slot. Here the basis is the gross fee itself:

```
FORMULA   offset(LP) = round( offset_total × gross_fee(LP) / Σ gross_fee , d )
          net_fee(LP) = round( gross_fee(LP) − offset(LP) , d )

LP01      offset  = round( 50,000 × 50,000 / 237,500 , 2 )
                  = round( 10,526.315789… , 2 )
                  = 10,526.32

          net_fee = round( 50,000.00 − 10,526.32 , 2 )
                  = 39,473.68
```

`Allocation_Method` on the offset picks the basis slot: gross fee (default),
commitment, or invested capital. Same formula, different denominator.

And only fee **payers** share it — [compute.ts:250](../src/engine/compute.ts#L250):

```ts
const payers = active.filter((l) => feeGross[l.LP_ID] > 0);
```

GP01 pays no fee, so GP01 gets no rebate. Giving a fee rebate to someone who
pays no fee would be meaningless.

If offsets ever exceed the gross fee, the net fee goes negative. That is a
**warn**, not a fail — it can be legitimate.

---

## 1.8 Step 4 — rolling it up, and the distinction that matters most

```
FORMULA   total_call(LP) = round( Σ component_shares(LP) + net_fee(LP) , d )
```

For LP01:

```
Deal X                  594,059.41
Deal Y                  396,039.60
Deal Z                  294,840.29
Partnership Expense      39,603.96
Organizational Expense   29,702.97
                      ────────────
                      1,354,246.23
net fee                  39,473.68
                      ────────────
TOTAL CALLED          1,393,719.91
```

### Inside vs outside commitment

This is the piece a non-accountant misses, and it is the reason the schema has
a `Reduces_Unfunded` flag per component.

Some money you call **counts against** what the investor promised. Some is
called **on top of it**.

```
FORMULA   reduces(LP) = round( Σ shares of components flagged Reduces_Unfunded='Y'
                               + net_fee(LP) if the fee is flagged 'Y' , d )

          outside(LP) = round( total_call(LP) − reduces(LP) , d )
```

Note it **adds up the flagged ones**. It does not subtract the unflagged ones.
Same answer here, but the code builds it that way so a new unflagged component
cannot quietly slip inside commitment.

Organizational Expense is flagged `'N'`, the fee block is flagged `'Y'`. LP01:

```
Deal X                  594,059.41   Y
Deal Y                  396,039.60   Y
Deal Z                  294,840.29   Y
Partnership Expense      39,603.96   Y
Organizational Expense       —       N  ← left out
net fee                  39,473.68   Y
                      ────────────
reduces               1,364,016.94

outside = 1,393,719.91 − 1,364,016.94 = 29,702.97
```

And the balances roll forward:

```
FORMULA   closing_UCC(LP)     = round( opening_UCC(LP)     − reduces(LP)    , d )
          closing_paid_in(LP) = round( opening_paid_in(LP) + total_call(LP) , d )

LP01      closing_UCC     = round( 8,000,000.00 − 1,364,016.94 , 2 ) = 6,635,983.06
          closing_paid_in = round( 2,000,000.00 + 1,393,719.91 , 2 ) = 3,393,719.91
```

Look at what each line uses. Unfunded is reduced by **`reduces`**. Paid-in is
increased by **`total_call`**. Two different numbers.

That asymmetry is the point: **everything** they pay increases paid-in capital,
but only the *inside* part decreases unfunded. Get it backwards and every
investor's remaining commitment is wrong forever after.

The management fee has its own `Reduces_Unfunded` flag on the fee block — here
it is `'Y'`, so the net fee is inside.

---

## 1.9 Step 5 and 6 — proving it

The engine does not trust itself. It re-derives its own totals a second way and
checks the two agree:

```
FORMULA   Σ closing_UCC      must equal   Σ opening_UCC     − Σ reduces
          Σ closing_paid_in  must equal   Σ opening_paid_in + Σ total_call
          Σ allocated        must equal   the component amount   (per component)
          Σ org expense      must be ≤    Org_Expense_Cap
```

Run against our fund:

```
ok: Unfunded roll-forward ties: 40,700,000.00 − 6,887,500.00 = 33,812,500.00.
ok: Paid-in roll-forward ties: 9,800,000.00 + 7,037,500.00 = 16,837,500.00.
ok: Organizational expense 150,000.00 vs cap 1,500,000.00.
```

"Ties" means the two sides matched. The tolerance is `1e-6` — well under a cent.

Then the part that makes this trustworthy rather than merely tidy.

### The golden fixture

The `golden` field on the model is the **Expected_Output tab of the accountant's
workbook, transcribed by hand**. Their answer, not the engine's. Every figure,
every investor.

`compute()` compares itself against it, column by column, to half a cent:

```
ok: Expected_Output fixture: every figure matches to the cent.
```

If a single number drifts, that check turns red and names the investor, the
column, expected and actual. This is the difference between "the code runs" and
"the code is right".

Run it:

```bash
npx vitest run src/engine/__tests__/golden.test.ts
```

---

## 1.10 The two tiny functions everything rests on

### `round()` and the 1e-9

[format.ts:33](../src/engine/format.ts#L33)

```ts
export function round(x: number, d: number): number {
  const f = Math.pow(10, d);
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}
```

Two things are going on, and neither is decoration.

**The `1e-9`.** Computers store `1.005` as very slightly *less* than 1.005.
Plain `Math.round(1.005 * 100)` gives 100, not 101 — it rounds **down**. The
nudge pushes it back over the line. Without it, allocations are off by a cent
and the golden test fails.

**The `Math.sign` / `Math.abs` dance.** Round the size, then put the sign back.
This makes −1.005 round to −1.01, mirroring +1.005 → +1.01. Fee offsets are
negative; they must round the same way as the fees they reduce.

### `Rounding_Decimals`, and a deliberate difference

[compute.ts:70](../src/engine/compute.ts#L70)

```ts
if (configured === '' || configured === null || configured === undefined) return 2;
return Math.max(0, Math.round(num(configured)));
```

Blank means "not set" → cents. **Zero means zero.** A fund reporting in yen sets
0 on purpose.

The original handoff implementation wrote `num(...) || 2`, which treats a
configured `0` as unset and silently gives it 2 decimals. This engine does not.
That difference is *asserted* in `equivalence.test.ts`, not hidden — a
divergence you can see is a decision; one you cannot is a bug.

---

## 1.11 One honest caveat

`totals.total` comes out of the engine as `7037500.000000001`.

It is a plain sum of already-rounded rows, and is not itself re-rounded. It is
displayed through `fmt()`, which fixes 2 decimals, so it reads `7,037,500.00`
everywhere a human sees it. Every **per-investor** figure is properly rounded;
this is only the fund-level sum. Worth knowing before you ever compare that raw
value to something with `===`.

---

## 1.12 Do it yourself

Everything above, on your machine:

```bash
npx vitest run src/engine/__tests__/golden.test.ts
```

Now break it. Open
[illustrative-fund.ts](../src/engine/fixtures/illustrative-fund.ts), find LP03,
and change `Mgmt_Fee_Rate_Override: 0.01` to `0.02`. Run it again.

It fails — **6 tests, 31 differences**.

Thirty-one, from changing one investor's rate. That is not noise, and it is the
most useful thing in this chapter. The 50,000 offset is shared *pro-rata to
gross fee*. Raise LP03's fee and the denominator moves, so **every** investor's
offset, net fee, total call, closing unfunded and closing paid-in all shift.

One input. Five investors you did not touch. Every downstream figure.

That is why the golden fixture exists, and why it compares every column for
every investor rather than spot-checking a total. A change like this would look
completely fine on any single number you happened to glance at.

Change it back and run it again. Green.

```bash
git checkout src/engine/fixtures/illustrative-fund.ts
npx vitest run src/engine/__tests__/golden.test.ts
```

That loop — move an input, watch what moves with it — is the whole engine.
Everything else is plumbing.

---

## 1.13 The formula sheet

Every formula in this chapter, in one place. `d` = decimal places, 2 unless the
fund says otherwise.

### Splitting one component across investors

```
                             basis(LP)
share(LP)  =  round(  total × ──────────────  ,  d )
                            Σ basis(all)

the plug   =  round(  total − Σ everyone else's shares  ,  d )
```

`basis` is commitment, unfunded (UCC), or invested capital — chosen per
component by `Allocation_Basis`.

### The management fee

```
rate(LP)       =  0                        if exempt
               =  Mgmt_Fee_Rate_Override   if that override is > 0
               =  the fund default         otherwise

gross_fee(LP)  =  round( basis(LP) × rate(LP) × period , d )
```

### An offset against the fee

```
                                       gross_fee(LP)
offset(LP)   =  round( offset_total × ──────────────── , d )      ← fee payers only
                                      Σ gross_fee

net_fee(LP)  =  round( gross_fee(LP) − offset(LP) , d )
```

### What each investor owes

```
total_call(LP)  =  round( Σ share(LP, each component) + net_fee(LP) , d )

reduces(LP)     =  round( Σ share(LP, components flagged Y)
                          + net_fee(LP) if the fee is flagged Y , d )

outside(LP)     =  round( total_call(LP) − reduces(LP) , d )
```

### Where they stand afterwards

```
closing_UCC(LP)      =  round( opening_UCC(LP)     − reduces(LP)    , d )
closing_paid_in(LP)  =  round( opening_paid_in(LP) + total_call(LP) , d )
```

### The checks

```
Σ closing_UCC      ==  Σ opening_UCC     − Σ reduces
Σ closing_paid_in  ==  Σ opening_paid_in + Σ total_call
Σ allocated        ==  component amount              (each component)
Σ org expense      <=  Org_Expense_Cap
every figure       ==  the accountant's Expected_Output tab, to half a cent
```

### Rounding

```
round(x, d)  =  sign(x) × ⌊ |x| × 10^d + 1e-9 + 0.5 ⌋ / 10^d
```

The `1e-9` is not cosmetic. Without it, `1.005` rounds **down**. See §1.10.

## What is in this chapter's folder

| File | Lines | Does |
|---|---:|---|
| [compute.ts](../src/engine/compute.ts) | 464 | the calculation, all six steps |
| [types.ts](../src/engine/types.ts) | 297 | the shape of everything |
| [notice.ts](../src/engine/notice.ts) | 271 | turns a computed row into notice text — chapter 5 |
| [format.ts](../src/engine/format.ts) | 134 | `num`, `round`, dates, money |
| [transfers.ts](../src/engine/transfers.ts) | 122 | settling the register |
| [carry-forward.ts](../src/engine/carry-forward.ts) | 87 | next call's opening balances = this call's closing |
| [allocate.ts](../src/engine/allocate.ts) | 73 | pro-rata + the plug |
| [empty-call.ts](../src/engine/empty-call.ts) | 65 | a blank new call |
| [summary.ts](../src/engine/summary.ts) | 47 | splits a call into against commitment, outside commitment and net fee, for the summary and the drawdown chart |

**Next:** Chapter 2 — the data. Where these numbers live, and who is allowed to
touch them.

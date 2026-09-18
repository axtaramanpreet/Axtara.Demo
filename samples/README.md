# Sample input workbooks

Drop one into **Set up call → Source** to exercise the upload path without
hand-typing a register.

| File | Fund | Use it for |
| --- | --- | --- |
| `meridian-growth-partners-iii-call-4.xlsx` | Meridian Growth Partners III, L.P. — Call 4 | The happy path. Eight investors, everything ties, **no WARN and no FAIL**. If this one flags anything, the app is wrong. |
| `thornfield-continuation-fund-ii-call-7.xlsx` | Thornfield Continuation Fund II, L.P. — Call 7 | Path coverage. **Raises four warnings and three INFO lines on purpose** — see below. Nothing should FAIL. |

Keep both. The first is the one that tells you something is broken; the second
is the one that tells you the awkward paths work.

## What the coverage sample walks through

Eleven investors (ten in the register, one arriving by transfer), seven
components, five transfers, three offsets.

- All three allocation bases — **Commitment**, **UCC**, **Invested_Capital** —
  on a fund whose investors are drawn anywhere from 25% to 90%, so the three
  give visibly different shares. In the Meridian sample everyone is drawn to
  the same percentage, which makes UCC and Commitment produce identical numbers.
- An investor **excused** from one component (LP03, regulatory grounds), and a
  second excused ID that does not exist.
- A component called **outside commitment** (`Reduces_Unfunded = N`).
- A component with an **unsupported basis** (`NAV`).
- A **full transfer** — LP05 leaves, LP08 is created — and a **partial** one
  into an investor already in the register.
- All three reasons a transfer is **refused**: dated after the call, an unknown
  transferor, and a percentage above 1.
- An investor in **default**, on the roster but out of the call.
- A **side-letter** fee rate, plus both kinds of fee exemption: a flag on the
  investor's own row, and an ID named in `Fee_Exempt_LP_IDs`.
- All three **offset methods**, and a zero-amount offset that is ignored.
- An investor **called beyond their unfunded commitment**.
- An **organizational expense over its cap**.

### Expected on upload

```
WARN  Regulated Asset Purchase: excused LP "LP99" is not in the register.
WARN  Placement Agent Fee: unknown Allocation_Basis "NAV", defaulted to Commitment.
WARN  LP09 Hallamshire Mutual: call against commitment (636,957.16)
      exceeds unfunded commitment (500,000.00).
WARN  Organizational expense 260,000.00 vs cap 200,000.00 — excess treated per LPA.
INFO  Transfer T3 not applied — effective 31 March 2027, after call date.
INFO  Transfer T4 not applied — From_LP_ID LP88 not in register.
INFO  Transfer T5 not applied — Transfer_Pct must be between 0 and 1.
```

Everything else is OK. **Nothing should FAIL.** Total call **17,828,750.00**.

## What no workbook can cover

Some settings are single-valued per fund, so alternatives cannot coexist in one
file: the fee basis, the rounding policy, and whether the rounding plug names a
real investor. Two paths are also left out deliberately:

- **A component whose basis sums to zero.** That is a FAIL, and a FAIL blocks
  approval — a sample carrying one could not be used to test the approve and
  send flow.
- **Offsets exceeding the gross fee**, which drives the net fee negative.

Both, and the single-valued alternatives, are covered by
`src/engine/fixtures/scenarios.ts` — 24 scenarios run against the engine and
differentially against the delivered spec engine.

## Input only

These are what a client sends: `Fund_Setup`, `LP_Register`, `Call_Components`,
`Management_Fee`, `Transfers`. Nothing else.

The handoff template also carries an `Expected_Output` tab. That tab describes
the **allocation sheet the app produces** — `export-allocation.ts` keeps its
column order so the two can be diffed — so no client would ever fill one in,
and a sample that shipped one would teach the wrong thing about the format.

The figures that tab would have held are assertions in the tests instead, taken
from the delivered spec engine rather than from ours, which is the only way an
expected answer is worth anything.

## Regenerating

These files are generated, not hand-edited. Each one's layout and every figure
live in its test, which also verifies the committed file still parses to the
same call:

```
WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/
```

| File | Defined by |
| --- | --- |
| `meridian-…-call-4.xlsx` | `src/adapters/workbook/__tests__/sample-workbook.test.ts` |
| `thornfield-…-call-7.xlsx` | `src/adapters/workbook/__tests__/sample-workbook-full.test.ts` |

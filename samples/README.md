# Sample input workbooks

Drop one of these into **Set up call → Source** to exercise the upload path
without hand-typing a register.

| File | Fund | What it exercises |
| --- | --- | --- |
| `meridian-growth-partners-iii-call-4.xlsx` | Meridian Growth Partners III, L.P. — Call 4 | A clean call that ties out: eight investors, a side-letter fee rate, a fee-exempt GP, a component allocated on unfunded commitment, an expense called outside commitment, two fee offsets, and a management fee charged on invested capital. |

Every figure ties, so nothing here should raise a WARN or a FAIL. If the app
shows one, the app is wrong.

## Input only

These are what a client sends: `Fund_Setup`, `LP_Register`, `Call_Components`,
`Management_Fee`, `Transfers`. Nothing else.

The handoff template also carries an `Expected_Output` tab. That tab describes
the **allocation sheet the app produces** — `export-allocation.ts` keeps its
column order so the two can be diffed — so no client would ever fill one in,
and a sample that shipped one would teach the wrong thing about the format.

The figures that tab would have held are assertions in
`src/adapters/workbook/__tests__/sample-workbook.test.ts` instead, taken from
the delivered spec engine rather than from ours, which is the only way an
expected answer is worth anything.

## Regenerating

These files are generated, not hand-edited. The layout and every figure live in
`src/adapters/workbook/__tests__/sample-workbook.test.ts`, which also verifies
that the committed file still parses to the same call:

```
WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/sample-workbook.test.ts
```

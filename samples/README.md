# Sample input workbooks

Drop one of these into **Set up call → Source** to exercise the upload path
without hand-typing a register.

| File | Fund | What it exercises |
| --- | --- | --- |
| `meridian-growth-partners-iii-call-4.xlsx` | Meridian Growth Partners III, L.P. — Call 4 | A clean call that ties out: eight investors, a side-letter fee rate, a fee-exempt GP, a component allocated on unfunded commitment, an expense called outside commitment, two fee offsets, and a management fee charged on invested capital. |

Every figure ties, so nothing here should raise a WARN or a FAIL. If the app
shows one, the app is wrong.

## About the Expected_Output tab

The figures on it come from the **delivered spec engine**
(`design_handoff_capital_call_engine 2/engine.js`), not from the engine that
reads them. That matters: a fixture an engine generated for itself only shows
the engine is self-consistent, and its green check in the Checks tab would mean
nothing. These come from a second implementation, so `Expected_Output: OK` on
upload is a real statement about the arithmetic.

The awkward cases — applied transfers, excused investors, zero-basis
components, over-calls — are covered by `src/engine/fixtures/scenarios.ts`
rather than by a workbook.

## Regenerating

These files are generated, not hand-edited. The layout and every figure live in
`src/adapters/workbook/__tests__/sample-workbook.test.ts`, which also verifies
that the committed file still parses to the same call:

```
WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/sample-workbook.test.ts
```

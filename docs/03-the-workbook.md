# Chapter 3 — The workbook

Chapter 1 took a `CallModel` as given. This chapter is **where one comes from
when the accountant hands over a spreadsheet**, and how the answer goes back
out as a spreadsheet.

The code is small: three files, 389 lines, in
[src/adapters/workbook/](../src/adapters/workbook/).

| File | Lines | Does |
|---|---:|---|
| [parse-workbook.ts](../src/adapters/workbook/parse-workbook.ts) | 157 | `.xlsx` → `CallModel` |
| [template-layout.ts](../src/adapters/workbook/template-layout.ts) | 121 | the list of every tab's columns and fields |
| [export-allocation.ts](../src/adapters/workbook/export-allocation.ts) | 111 | computed result → `.xlsx` download |

An **adapter** is code that translates between the outside world and the
engine. The engine only speaks `CallModel`. The adapters make everything else
speak it too.

---

## 3.1 Four ways to start a call

The **Source** step of Set up call
([source-step.tsx](../src/components/setup/source-step.tsx)) asks *"Where do
the inputs come from?"* and offers four:

| On screen | What fills the call | Stepper label |
|---|---|---|
| **Drop the input workbook (.xlsx)** (or click to browse; `.xlsx`, `.xlsm`, `.xls`) | the accountant's file, through this chapter's parser | From Excel |
| **Enter inputs manually** | nothing; empty tables to type into | Manual |
| **Carry forward the register from Call No. N** (only shown when there's a previous call) | last call's **closing** balances as this call's **opening** ones | Carried forward |
| **Load illustrative template data** | the chapter 1 fund, in full | Template |

All four end in the same place: a `CallModel` in the screen's state, saved
through `save_call_inputs` (chapter 2, §2.9).

---

## 3.2 The template

The accountant's workbook has one tab per part of the model:

| Tab | Layout | Becomes |
|---|---|---|
| `Fund_Setup` | list | `model.setup` |
| `LP_Register` | table, header `LP_ID` | `model.lps` |
| `Call_Components` | table, header `Component_ID` | `model.components` |
| `Management_Fee` | list **and** a table, header `Offset_ID` | `model.fee` and `model.fee.offsets` |
| `Transfers` | table, header `Transfer_ID` | `model.transfers` |
| `Expected_Output` | table, header `LP_ID` | `model.golden` (optional) |

The original template is
`design_handoff_capital_call_engine 2/uploads/capcall_input.xlsx`. The chapter 1
fund *is* that workbook, and its `golden` rows are its Expected_Output tab,
typed out by hand.

### One list, used twice

[template-layout.ts](../src/adapters/workbook/template-layout.ts) lists every
column and field once:

```ts
export const LP_COLUMNS: ColumnDef[] = [
  { key: 'LP_ID', w: 64 },
  { key: 'LP_Name', w: 200 },
  { key: 'Commitment', w: 120, num: true },
  …
];
```

The **parser** reads it to know which keys to pick up. The **Set up screens**
read the same list to draw their editable tables. Add a column here and it
shows up in both places. The spreadsheet and the screen can't drift apart,
because there's only one list.

It also holds the suggestion lists for dropdown-style columns:

```ts
'dl-basis':  ['Commitment', 'UCC', 'Invested_Capital'],
'dl-status': ['Active', 'Transferred', 'Defaulted'],
```

These are **suggestions**, not rules. You can still type `Vibes`. The database
stores it (chapter 2, §2.3), and the engine flags it as a warning.

---

## 3.3 Step 1: a sheet becomes a grid

SheetJS (the `xlsx` package) does the actual file reading. The parser asks it
for each tab as a plain grid, rows of cells:

```ts
XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
```

| Option | Means |
|---|---|
| `header: 1` | give me rows as arrays, don't guess column names |
| `raw: true` | give me the stored value (a date is a number, see §3.6) |
| `defval: ''` | an empty cell is `''`, not missing |

So `LP_Register` arrives as:

```
[ ['LP_ID', 'LP_Name',             'LP_Type', 'Commitment', …],
  ['LP01',  'Alpha Pension Trust', 'LP',      10000000,     …],
  ['LP02',  'Beta University…',    'LP',      7500000,      …],
  … ]
```

### SheetJS is passed in, not imported

```ts
export function parseWorkbook(XLSX: WorkbookReader, wb: WorkbookLike, baseline: CallModel)
```

The parser never imports SheetJS itself. Whoever calls it passes SheetJS in.
Two reasons:

- **Tests** can hand it anything shaped the same way.
- **Size.** SheetJS is big. The Set up screen loads it only when someone
  actually picks a file:

```ts
const [XLSX, workbook] = await Promise.all([
  import('xlsx'),
  import('@/adapters/workbook/parse-workbook'),
]);
```

A dynamic `import()` like that means the browser downloads the code at that
moment, not with the page. Pages that never read a file never pay for it.

---

## 3.4 Step 2: two small readers

Every tab is one of two layouts, so there are exactly two readers.

### A list: `readKeyValues`

`Fund_Setup` looks like this:

```
Field               Value
Fund_Name           Illustrative Fund II, L.P.
Call_Date           2026-09-30
Rounding_Plug_LP_ID LP04
```

```
RULE   for each row:
         key = column A,  value = column B
         skip the row if key is blank, key is "Field", or value is blank
```

**Skipping blank values matters.** A half-filled template has rows with a field
name and nothing next to it. Reading those would overwrite a good existing
value with `''`.

### A table: `readTable(grid, headerKey)`

```
RULE   start:  the first row whose column A is exactly headerKey
       read:   every row after it
       stop:   at the first row whose column A is blank
```

So `readTable(grid('LP_Register'), 'LP_ID')` finds the row starting `LP_ID`,
uses it as the header, and reads down until it hits a blank.

That stopping rule does two jobs without any special code:

- `Management_Fee` holds a list *and* an offsets table. Looking for `Offset_ID`
  jumps straight to the table part.
- `Expected_Output` ends with a `TOTAL` row whose `LP_ID` cell is blank. The
  reader stops before it, so the total never becomes a seventh investor. There's
  a test for exactly that: *"stops at the totals row rather than reading it as
  an investor"*.

### The one careful line

Say a workbook has a blank column header in the middle:

```
header:  LP_ID | LP_Name | (blank) | Commitment | Opening_Paid_In
row:     LP01  | Alpha   | x       | 10000000   | 2000000
```

```ts
header
  .map((k, i) => [k, row[i] ?? ''])   // 1. pair each header with its value BY POSITION
  .filter(([k]) => Boolean(k))        // 2. THEN drop the blank-header pairs
```

In that order, `Commitment` gets `10000000`. Correct.

Do it the other way round (drop blank headers first, then pair) and every
column after the gap shifts left by one. `Commitment` gets `x`, and
`Opening_Paid_In` gets `10000000`. Nothing crashes. An investor's commitment
just ends up filed as their paid-in capital. The comment in the code warns
about exactly this.

Extra columns the template doesn't know about are kept, not thrown away.

---

## 3.5 Step 3: laid on top of what's already there

```ts
const model = structuredClone(baseline);
…
if (lps.length) model.lps = lps;
```

The parser starts from a copy of a **baseline** model and only replaces the
parts the workbook actually has.

```
RULE   Fund_Setup, LP_Register, Call_Components
         has rows          →  replace that part
         missing or empty  →  keep the baseline's value

       Management_Fee
         tab present       →  fee fields it has are updated, the rest kept;
                              offsets REPLACED, even if the tab has none
         tab missing       →  keep the baseline's fee and offsets

       Transfers
         tab present       →  replace, even if it has no rows
         tab missing       →  keep the baseline's value

       Expected_Output
         always replaced   →  no tab means no golden answers
```

The difference is easy to miss. A `Transfers` tab with just its header row
means "there are no transfers", so it clears any you had. The same goes for a
`Management_Fee` tab with no offsets table. A workbook
with no `Transfers` tab at all says nothing about them, so yours stay.

The Set up screen passes **the call as it is right now** as the baseline. So
uploading a workbook that only has `LP_Register` replaces the register and
leaves your components alone.

Two special cases:

- **`Call_Number` is ignored.** The call already has a number that's unique in
  the fund. Taking the workbook's could clash with another call, so the screen
  puts the old number back after parsing.
- **Fee fields are picked by name.** Only keys in `FEE_FIELDS` are lifted off
  `Management_Fee`, so stray cells on that tab can't sneak into the fee.

---

## 3.6 Excel dates

Excel doesn't store `14 Oct 2026`. It stores **the number of days since
30 December 1899**. That day is 0, so `2026-10-14` is `46310`.

```
FORMULA   iso_date = the date (serial − 25569) days after 1 Jan 1970

          25569 = the Excel serial number of 1 Jan 1970
          so (serial − 25569) = days since 1970
          and × 86,400,000    = milliseconds, which is what JavaScript counts in

EXAMPLE   46310 − 25569 = 20741 days after 1 Jan 1970 = 2026-10-14
```

```ts
new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
```

Applied to `Call_Date`, `Payment_Due_Date` and every transfer's
`Effective_Date`. A date typed as text is left as text, and the engine deals
with it (`serialToISO`, chapter 1).

---

## 3.7 It all runs in your browser

The file is read **on the accountant's own machine**:

```
pick file  →  file.arrayBuffer()  →  XLSX.read()  →  parseWorkbook()
           →  CallModel in the screen's state      →  save_call_inputs
```

The `.xlsx` itself is never uploaded. What reaches the server is the model,
through the same all-or-nothing save as typing by hand.

Then the screen shows a short "reading…" animation
([processing-overlay.tsx](../src/components/setup/processing-overlay.tsx)) and
the message:

> Read *file.xlsx* — 6 investors and 5 components. Check the figures below
> before allocating.

---

## 3.8 Going back out: Download allocation

[export-allocation.ts](../src/adapters/workbook/export-allocation.ts) turns a
computed call into a two-sheet `.xlsx`, built in the browser too.

### Sheet 1, `Allocation`

Same column order as the template's `Expected_Output` tab:

```
LP_ID | LP_Name | Commitment | Opening_UCC | Opening_Paid_In |
Deal X | Deal Y | … (one per component) |
Fee_Rate | Fee_Gross | Fee_Offset | Fee_Net | Total_Call |
Reduces_Unfunded_Amt | Closing_UCC | Closing_Paid_In | Status
```

Because the order matches, the accountant can put our output next to their
own model and compare the two column by column.

Plus a `TOTAL` row, and a title row naming the fund, call number, dates and
currency.

**An excused investor's cell says `excused`, not `0`.** A zero looks like
"called for nothing". `excused` says "wasn't part of this one". Those mean
different things, so they're written differently.

### Sheet 2, `Checks`

Every `ok` / `warn` / `fail` line from the engine. If an Expected_Output was
supplied, every difference from it too.

The reason, from the file itself:

> a file of figures with no record of what was verified is a file somebody will
> eventually trust more than they should.

File name: `Capital_Call_02_Allocation.xlsx`.

---

## 3.9 How it's tested

[src/adapters/workbook/__tests__/](../src/adapters/workbook/__tests__/)

| Test file | Proves |
|---|---|
| `parse-workbook.test.ts` | the real template parses to every investor, component, offset and transfer; dates become ISO; the TOTAL row is skipped; the result matches the hand-typed fixture to the cent; and it reads **identically to the original handoff parser** |
| `sample-workbook.test.ts` | `samples/meridian-growth-partners-iii-call-4.xlsx`, the happy path: 8 investors, no warnings, no failures |
| `sample-workbook-full.test.ts` | `samples/thornfield-continuation-fund-ii-call-7.xlsx`, path coverage: all three bases, excusals, transfers applied and refused, exemptions, all three offset methods, exactly four deliberate warnings |

The two sample files are **generated from the test definitions**, not edited by
hand. That way the file you drop into the app can't drift away from what the
tests expect. To rebuild one:

```bash
WRITE_SAMPLE=1 npx vitest run src/adapters/workbook/__tests__/sample-workbook.test.ts
```

[samples/README.md](../samples/README.md) lists every awkward case the coverage
sample walks through.

---

## 3.10 Honest gaps

I found these while writing this chapter. None of them is fixed.

**1. The original file isn't kept.** `calls` has `source_file_name` and
`source_file_path`, with the comment *"The workbook as uploaded, kept in Storage
so the original is auditable."* Nothing writes either column, and nothing
uploads the file. Once a call is saved, there's no way to get back the
spreadsheet it came from.

**2. Ask Axtara always says "manual".** It reports
`input_source: call.sourceFileName ?? 'manual'`. Because of gap 1,
`sourceFileName` is always empty. So a call built from a workbook is described
to the AI as typed in by hand.

**3. Everything gets labelled "From Excel".** After an upload, all five steps
are marked `excel`, even a step whose tab wasn't in the workbook and whose
values were kept from before (§3.5). The stepper then says "From Excel" about
data that didn't come from Excel.

**4. A code comment is out of date.** `parseWorkbook`'s comment says the
baseline is "normally a fresh copy of the illustrative template". It isn't. The
screen passes the current call, which is the safer behaviour. The comment
describes an older version.

---

## 3.11 Do it yourself

```bash
npm run dev
```

1. Open a call's **Set up** page, then **Source**.
2. Upload `samples/thornfield-continuation-fund-ii-call-7.xlsx`.
3. Open **Review allocation**, then the **Checks** tab. You should see exactly
   four warnings and nothing failing. [samples/README.md](../samples/README.md)
   says which four, and why each is deliberate.
4. Press **Download allocation**. Open the file and find LP03's cell under the
   regulated-asset component. It says `excused`.

Or, without the app:

```bash
npx vitest run src/adapters/workbook
```

**Next:** Chapter 4, the screens. Which code runs on the server, which in the
browser, and why.

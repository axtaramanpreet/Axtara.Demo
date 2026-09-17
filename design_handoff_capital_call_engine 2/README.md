# Handoff: Capital Call Engine

## Overview
A fund-accounting tool for capital calls. Per client (fund) it keeps a history of calls (issued · in progress · not started). Each call takes the accountant's input workbook (Fund_Setup, LP_Register, Call_Components, Management_Fee, Transfers) or manual entry, allocates the call across LPs, reproduces the accountant's `Expected_Output` tab to the cent, runs tie-out checks, and produces one Capital Call Notice per LP with a Draft → Approved → Sent workflow. A grounded Q&A panel ("Ask Axtara") answers questions from the fund's own data only.

## Navigation model (three views, no global tab bar)
1. **Home** (per client) — list of all calls + fund position + drawdown chart. Single primary CTA "New capital call".
2. **Set up call** — separate screen with a left stepper (Source → Fund setup → LP register → Call components → Management fee → Transfers). Reached from "New capital call" or "Edit inputs". "Review allocation ›" runs the calculation and opens the call.
3. **Call** — Summary · Allocation · Checks · Notices tabs. Breadcrumb "‹ All calls".
Header on every view: "Capital calls" label, client `<select>` + "+ New client", right side "Ask Axtara" button + Light/Dark toggle.

## About the Design Files
The files in this bundle are **design references built in HTML** — a working prototype showing intended look and behaviour, not production code to ship. Recreate them in the target codebase's existing environment (React/Next, Vue, etc.) using its patterns and libraries. If no environment exists, a React + TypeScript app with SheetJS for xlsx parsing is the natural fit; `engine.js` and `defaults.js` are framework-free and can be ported almost verbatim (they are the spec for the calculation logic).

## Fidelity
**High-fidelity.** Colours, type, spacing and interactions are final. Recreate the UI faithfully using the codebase's own component primitives (buttons, tables, tabs). The calculation engine must match `Expected_Output` exactly — treat the golden rows in `defaults.js` as a required regression test.

## Files
- `Capital Call Engine.dc.html` — full UI: template markup (between `<x-dc>` tags) + logic class (in the trailing `<script data-dc-script>`). Inline styles + a small `<style>` block with tokens/classes.
- `engine.js` — pure calculation: `compute(model)`, `allocate()`, `applyTransfers()`, `buildNotice()`, formatters. **Port this first.**
- `defaults.js` — template data (the illustrative fund), golden `Expected_Output` rows, column definitions per tab, `parseWorkbook(XLSX, wb)` (reads the Excel template layout).
- `uploads/capcall_input.xlsx` — the accountant's input template (all tabs + Expected_Output).
- `uploads/Capital_Call_Notice_DRAFT.pdf` — the reference notice layout (payment instructions deliberately omitted in the design).

## Design Tokens (from the client's theme; all colours oklch)
Light: background 0.99 0 0 · card 1 0 0 · foreground 0 0 0 · muted 0.97 0 0 · muted-foreground 0.44 0 0 · accent 0.94 0 0 · border 0.92 0 0 · primary 0 0 0 / primary-foreground 1 0 0 · destructive 0.63 0.19 23.03 · chart-1 0.81 0.17 75.35 (amber) · chart-2 0.55 0.22 264.53 (blue) · chart-3 0.72 0 0 · chart-4 0.92 0 0 · chart-5 0.56 0 0 · shadow `0 1px 2px hsl(0 0% 0% / 0.06)`.
Dark (`.dark`): background 0 0 0 · card 0.14 0 0 · foreground 1 0 0 · muted 0.23 0 0 · muted-foreground 0.72 0 0 · accent 0.32 0 0 · border 0.26 0 0 · primary 1 0 0 / primary-foreground 0 0 0 · destructive 0.69 0.20 23.91 · chart-2 0.58 0.21 260.84.
Radius 0.5rem (cards, buttons), 4px (inputs). Fonts: **Geist** (UI, 14px base), **Geist Mono** (all figures, 12.5px, `tabular-nums`). Headings 600 weight, -0.01em tracking; h2 22px, h3 18px, h4 14px.

## Shared components
- **Button** 34px tall, 13px/500, radius 0.5rem. `primary` = primary bg; `secondary` = card bg + border + shadow; `ghost` = transparent, muted text, accent bg on hover. Disabled = default disabled styling.
- **Tag** = 7px coloured dot + 12px text. accent → chart-2 dot; accent-2 → destructive text+dot; warn → chart-1 dot; neutral → chart-3 dot.
- **Table** 13px; header 12px/500 muted-foreground on muted bg, 1px border rows, row hover muted, 8px×12px cell padding, last row no border. Inside a card: 16px outer padding.
- **Card** card bg, 1px border, radius, shadow, `overflow:hidden`. `card-h` header: 12px×16px padding, 600 title left, muted 12px subtitle right, bottom border.
- **Editable cell** transparent input, border appears on hover (border colour) and focus (ring), 30px min-height, right-aligned for numeric columns, `<datalist>` suggestions for enum columns (Y/N, basis, category, type, status).
- **Theme toggle** pill with Light/Dark segments; selected segment primary bg. Persisted.

## Screens

### Header (all views)
Left: 13px muted "Capital calls"; below it a 20px/600 borderless `<select>` for the client with a 1px bottom rule, plus ghost "+ New client" (prompts for a name → empty client, lands on Home). Right: secondary "Ask Axtara", Light/Dark pill toggle (persisted). Hidden `<input type=file>` for .xlsx.
Status line (dismissable) at the top of main after uploads/sends/carry-forward: tag + message + "dismiss".

### Home
Title row: h1 = fund name, muted one-line hint ("Call No. 2 is in progress — open it to continue, or start a new call." / "All calls issued…" / "No calls yet."), primary **New capital call** (38px) right-aligned. New call: reuses an existing not-started call if one exists; otherwise creates Call No. max+1 with setup defaults and fee config copied from the latest call, then opens Set up → Source.
Grid `repeat(auto-fit, minmax(min(100%,560px),1fr))`, 16px gap, max 1200px:
1. **Capital calls** card — subtitle "N issued · N open". Table: No. (mono, zero-padded) / Notice date (+ muted "due <date>" second line) / Amount called / Notices ("4 / 6 sent") / Status tag / action ("Set up ›" · "Continue ›" · "View ›"). Newest first; in-progress row bold. Stage: Not started (neutral) · In progress (warn) · Partially sent (warn) · Issued (accent). Row click → Call view (or Set up for not-started).
2. **Fund position** card — Total commitments, Called to date (N calls), Paid-in capital, ruled bold Unfunded commitment, Investors, Next payment due. Subtitle "after Call No. N" / "before Call No. N".
3. **Drawdown history** card (full width) — one column per call: stacked segments against commitment (chart-2) / outside (chart-1) / fee net (chart-5), amount above, "Call NN" + "x.x% drawn" cumulative below; not-started call drawn as a dashed outline column sized like the latest call with its planned date. Legend right + summary sentence "33.3% of USD 50,500,000 drawn across 2 calls." Bars animate up (scaleY, 0.6s) on mount.
Empty state (client has no calls): card "No capital calls yet" + explanation + primary button.

### Set up call
Breadcrumb "‹ All calls". h1 "Set up Capital Call No. N", muted line with current total if any. Right: ghost "Delete call" (not for issued calls, confirm dialog) + primary "Review allocation ›".
Layout: 240px sticky left stepper + content. Stepper items: number circle (✓ filled when done), label, muted detail ("From Excel · 6 investors", "Manual · 5 items · USD 6,850,000", "Carried forward · …", "Empty · deals and expenses"). Active item accent bg.
Steps:
- **Source** — h2 "Where do the inputs come from?", drop zone (1.5px dashed chart-3, 34px padding, "Drop the input workbook (.xlsx)" / "or click to browse · tabs …"), then secondary "Enter inputs manually", link "Carry forward the register from Call No. N" (when a previous call with LPs exists: closing paid-in/UCC → opening; invested capital += deal allocations), muted link "Load illustrative template data".
- Fund setup / Management fee: Field / Value (input) / Notes tables in a card. Fee step adds Offsets table (Offset_ID, Description, Amount, Allocation_Method) and "Gross · offsets · net" line.
- LP register, Call components, Transfers: wide editable tables in a card (horizontal scroll), "+ Add …" ghost, red × per row. Any edit flips that step's source to Manual and recalculates.
Columns:
- Fund Setup / Management Fee: Field / Value (input) / Notes tables. Fee tab adds an Offsets table (Offset_ID, Description, Amount, Allocation_Method) and a gross · offsets · net summary line.
- LP Register columns: LP_ID, LP_Name, LP_Type, Commitment, Opening_Paid_In, Opening_UCC, Opening_Invested_Capital, Mgmt_Fee_Rate_Override, Fee_Exempt, Status, Side_Letter_Ref, Contact_Email, Notes.
- Call Components: Component_ID, Component_Name, Category, Total_Amount, Allocation_Basis (Commitment|UCC|Invested_Capital), Reduces_Unfunded, Excused_LP_IDs, Notes; total-before-fee line beneath.
- Transfers: leading "Applied / Not applied" tag, then Transfer_ID, Effective_Date, From_LP_ID, To_LP_ID, To_LP_Name_if_new, Transfer_Type (Full|Partial), Transfer_Pct, Transfers_Commitment, Transfers_Paid_In, Transfers_UCC, Notes.
Wide tables scroll horizontally (`width:max-content; min-width:100%`).

### Processing overlays
Two stepped "AI extraction" sequences shown in a centred 440px card over a 75%-opaque backdrop: spinner + title, 3px progress bar, list of steps with state circles (pending grey ring · active spinning ring · done filled) and "working…/done" notes; ~520ms per step.
- Upload: "Reading <file>" → Opening workbook · Extracting Fund_Setup · Extracting LP_Register · Extracting Call_Components and Management_Fee · Reading Transfers and Expected_Output · Mapping fields to the engine. Then lands on Set up → Fund setup with the status line. If the workbook's Call_Number collides with an existing call the call keeps its own number and the status says so.
- Review allocation: "Preparing Capital Call No. N" → Applying transfers · Allocating components pro-rata · Computing management fee and offsets · Running tie-out checks · Drafting investor notices. Then opens Call → Summary.

### Call view
Breadcrumb "‹ All calls". h1 "Capital Call No. N" + stage tag; muted "Notice date … · payment due … · N investors". Right: secondary "Edit inputs", "Export .xlsx". Tabs (2px underline): Summary · Allocation · Checks (n failing/warnings) · Notices (x/y sent).

#### Summary
Grid `repeat(auto-fit, minmax(min(100%,520px),1fr))`:
1. **Call summary** card — ledger: Called against commitment, Called outside commitment, Management fee net of offsets, ruled bold Total amount called, then "Unfunded before → after", "Paid-in before → after". Footer 1: tags "N checks passed / N warnings / N failing" + "View checks" link. Footer 2: readiness sentence ("4 of 6 notices sent, 1 approved, 1 in draft." / "All 6 notices sent." / "N check(s) failing — resolve before issuing notices.") + "Open notices" link.
2. **Purpose of call** card — Line item / Basis / Commitment (Inside|Outside) / Amount / % + total row (scrolls if narrow).
3. **Allocation by investor** card (full width) — ID / Investor / Commitment / Against commitment / Outside / Fee net / **Total call** / Share of call (10px bar sized to the largest LP, coloured by notice status: amber draft · blue approved · grey sent, with % of call) / Unfunded after / Notice tag. Total row. Row click → Notices with that LP selected.

#### Allocation
Muted intro + secondary "Download allocation (.xlsx)". One wide mono table, shape fixed like Expected_Output: LP_ID, LP_Name, Commitment, Opening_UCC, Opening_Paid_In, one column per component, Fee_Rate, Fee_Gross, Fee_Offset, Fee_Net, **Total_Call**, Reduces_Unfunded, Closing_UCC, Closing_Paid_In; bold TOTAL row with 1px foreground top border. Non-active LPs (transferred) at 45% opacity; excused cells read "excused". Export writes an `Allocation` sheet plus a `Checks` sheet.

### Checks (detail)
List of rows: 80px tag (OK / WARN / FAIL / INFO) + text. Checks produced by the engine: transfer applied/skipped, each component ties to total (with plug LP), unknown basis defaults, offset tie-out, offsets exceed gross fee, LP call exceeds unfunded, unfunded and paid-in roll-forwards, org-expense cap vs total, Expected_Output regression (cent-level). If diffs exist, a table LP / Field / Expected / Engine (engine value in destructive colour).

#### Checks
As before (list card + Expected_Output diff table).

#### Notices
Toolbar: secondary "Print / save PDF" (window.print; `[data-noprint]` hidden, one notice per page), ghost "Show all N notices / Show one investor", right-aligned tally "n sent · n approved · n draft", secondary "Approve all drafts" (disabled when none or checks failing), primary "Send all approved". Red line if checks fail: approval disabled.
Left rail (220px): one row per active LP — name (ellipsised) + workflow tag; selected row muted bg.
Per notice, an action bar above the sheet: workflow tag + detail ("review, then approve" / "approved <ts> — ready to send" / "sent <ts> to <email>"), then right-aligned: Draft → **Approve**; Approved → ghost "Back to draft", primary "Send to <email|name>"; Sent → ghost "Mark unsent", ghost "Resend". If no Contact_Email and not draft: link "Add Contact_Email in LP Register to email this notice".
Send = record `{status:'sent', sentAt}` per LP per call number and open `mailto:` pre-filled (subject "<Fund> — Capital Call Notice No. N"; body one line per LP with total due and due date). No mail server in the prototype — production should attach the PDF and send via the firm's provider.

**Notice sheet** (820px max, card styling, 56px×64px padding, 14px/1.5): top-right red tracked caps "DRAFT — FOR REVIEW ONLY" while draft (prop `draftWatermark`), replaced by muted "ISSUED <date>" once sent. Fund name 20px/600, "c/o the General Partner" 12px muted. h3 "Capital Call Notice" 26px. Meta grid (auto-fit 160px): Notice No., Notice date, Payment due, Investor, Investor ID, Currency — 11px caps labels. "Re:" line, "Dear Limited Partner," and the standard LPA paragraph. Total band: 2px top rule / 1px bottom, caps "TOTAL AMOUNT DUE" left, 22px mono amount right.
Section A "Purpose of this Capital Call": table with lines inside commitment (Investment — Deal X¹ …, Partnership Expense, Management Fee (2.00% p.a., current period)², Less: Management Fee Offset² shown negative in parentheses), bold "Subtotal — called against capital commitment", lines outside commitment (Organizational Expense (outside commitment)³), bold ruled "Total Amount Called".
Section B "Your Capital Account Summary": Total Capital Commitment, Contributions prior, Contributions called — against commitment, — outside commitment (if any), **Total Contributions to Date**, Unfunded before, Less applied, **Unfunded after**.
Notes: auto-generated numbered footnotes — one per allocation basis used, the fee sentence (rate, basis, offset share, net), the outside-commitment sentence, an excused-LP sentence when relevant, rounding statement. Signature block: "For and on behalf of the General Partner of <Fund>" + 240px rule "Authorized Signatory". **No payment instructions.**

### Ask Axtara (Q&A panel)
Right-side 400px slide-in panel (`translateX` 0.28s), card bg, left border + soft shadow, above content on every view. Header: "Ask Axtara" + muted "Answers only from <fund> data · read-only", ghost "Clear", "×". Body: scrollable message list — user bubbles primary bg right-aligned (radius 10px, 3px bottom-right), assistant bubbles muted bg left-aligned; typing indicator = three blinking dots; empty-state hint sentence. Footer: 3 contextual suggestion chips (pill, 12px) that change by view (home / summary / checks / notices), textarea (Enter sends, Shift+Enter newline) + primary "Ask" (disabled while busy), 11px disclaimer "Uses only this client's register, call inputs, computed allocations, checks and notice status. It cannot change inputs or approve notices."
Behaviour: each question is sent with a system prompt + JSON of the selected client's data (setup, fee config, components, transfers, per-LP computed allocation incl. notice status, totals, checks, Expected_Output diffs) and the last 8 turns. Rules for the model: answer only from the data, plain text (no Markdown), 2–5 sentences or short list, cite every figure in brackets to its source row (e.g. `[LP03 · Mgmt_Fee_Rate_Override 0.01 · SL-2024-03]`), read-only, may end with `GOTO: <call_number>|<summary|output|checks|notices>` which the UI turns into an "Open Call No. N · Tab ›" link under the bubble. Markdown is stripped client-side as a fallback. Conversation is per client, in memory (not persisted). In production plug the real endpoint into `askChat()`; the prototype uses `window.claude.complete` when available and otherwise shows a "not connected yet" reply.

## Calculation rules (see engine.js)
- Transfers applied first when Effective_Date ≤ Call_Date; partial splits each flagged balance by pct; full marks transferor Transferred; new To_LP_ID is appended to the roster.
- Each component allocated pro-rata to its basis (Commitment / Opening_UCC / Opening_Invested_Capital) over active, non-excused LPs; rounded to `Rounding_Decimals`; residual to `Rounding_Plug_LP_ID` (fallback largest participant).
- Fee gross = basis × rate × period fraction; rate = 0 if Fee_Exempt or in Fee_Exempt_LP_IDs, else override, else default. Offsets allocated by method (Pro-rata to gross fee | Commitment | Invested_Capital) over fee payers, same plug. Net = gross − offsets.
- Total_Call = Σ components + fee net; Reduces_Unfunded_Amt = Σ components flagged Y + fee (if Reduces_Unfunded Y); Closing_UCC = Opening_UCC − reduces; Closing_Paid_In = Opening_Paid_In + total.
- Golden test: `defaults.js → DEFAULT_MODEL.golden` must match within 0.005.

## State
Per client: `{id, name, calls:[{id, model{setup,lps,components,fee{…,offsets},transfers,golden}, sources{setup|lps|components|fee|transfers → excel|manual|template|carried|empty}, lastFile, workflow{LP_ID→{status:draft|approved|sent, approvedAt, sentAt}}}]}`. Stage is derived per call: no LPs and no components → Not started; all active LPs sent → Issued; some sent → Partially sent; else In progress. Persisted (localStorage key `capcall.clients.v2` in the prototype; a database in production). UI state: client, view (home|setup|call), callId, tab, step, selected notice LP, show-all, theme, status message, processing overlay, chat (open, per-client messages, draft, busy).

## Props / tweaks
`theme: light|dark`, `draftWatermark: boolean`.

## Seed / demo data
Illustrative Fund II ships with Call 1 (issued, 6 notices sent), Call 2 (the client's template workbook — matches Expected_Output), Call 3 (not started, 31 Dec 2026). Illustrative Fund III has no calls (empty state). Sample `Contact_Email` values are on the register.

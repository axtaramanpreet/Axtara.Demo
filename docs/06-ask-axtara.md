# Chapter 6 — Ask Axtara

The chat panel in the corner. You ask *"Which notices are still unsent?"* and it
answers with figures from this fund.

This chapter explains **what the AI can see, what it can't, and what stops it
from making things up**.

There's no framework here: no LangChain, no vector database, no "retrieval".
It's one idea, done plainly:

> Every time you ask, the server reads the **whole fund** fresh from the
> database, puts it in the prompt as JSON, and asks Claude to answer **only from
> that**.

| File | Lines | Does |
|---|---:|---|
| [ask-axtara.tsx](../src/components/ask/ask-axtara.tsx) | 376 | the panel: suggestions, typing effect, citations |
| [store.ts](../src/components/ask/store.ts) | | the conversation, kept outside React |
| [api/ask/route.ts](../src/app/api/ask/route.ts) | | the server side of one question |
| [fund-context.ts](../src/server/fund-context.ts) | 129 | builds the JSON the model reads |
| [ask.ts](../src/server/ask.ts) | 168 | the rules (system prompt), the call to Claude, cleaning the reply |
| [env.ts](../src/lib/env.ts) | | `foundryEnv()`: the endpoint, key and model |

---

## 6.1 One question, start to finish

```
BROWSER   you type "Which notices are still unsent?"
          POST /api/ask
          {
            fundId:    "f1",
            question:  "Which notices are still unsent?",
            viewing:   { callNo: 2, tab: "notices" },
            history:   [ the last 4 questions and answers ]
          }
                        ▲ no fund data in here. None.

SERVER    1. signed in?                          no → 401
          2. listFunds() AS YOU                (RLS, chapter 2 §2.4)
             is f1 one of yours?                 no → 404
          3. load EVERY call for f1, AS YOU
          4. buildFundContext(): compute() each call → one JSON snapshot
          5. systemPrompt(snapshot, viewing)
          6. complete(): send it to Claude on Microsoft Foundry
          7. stripMarkdown(), then takePointer()
          8. turn "GOTO: 2|notices" into a real link
          → { reply, goto }

BROWSER   types the answer out a word or two at a time
          draws [ … ] parts as citation tags
          shows "Open Call No. 2 · Notices" under it
```

### Two decisions that matter

**The browser never sends fund data.** It sends a question and which screen
you're on. The server reads the data itself. So the browser never has to hold
the whole register to ask about it, and a tampered request can't feed the model
made-up figures.

**The server reads as you, never with the service key.** Step 2 and 3 use
`getServerSupabase()`, so RLS decides which funds exist for you. With the
service-role key, anyone signed in could ask about any client's register. The
route's own comment says exactly that.

---

## 6.2 What the model reads: the snapshot

[fund-context.ts](../src/server/fund-context.ts) builds this for **every
question**:

```
{
  fund: "Illustrative Fund II, L.P.",
  today:  "2026-09-23",
  calls: [                                   newest first
    {
      call_number:  2,
      stage:        "in_progress",
      notice_date:  "2026-09-30",
      payment_due:  "2026-10-14",
      input_source: "manual",
      setup, fee_config, components, transfers,     ← the inputs, as stored
      allocation: [                                 ← compute(), one per investor
        { LP_ID: "LP01", LP_Name: "Alpha Pension Trust",
          Commitment: 10000000, Opening_UCC: 8000000,
          components: { "Deal X": 594059.41, … },
          Fee_Gross: 50000, Fee_Offset: 10526.32, Fee_Net: 39473.68,
          Total_Call: 1393719.91, Closing_UCC: 6635983.06, …,
          Contact_Email: "treasury@alphapension.example",
          notice_status: "draft", notice_sent_at: null },
        …
      ],
      totals, checks, expected_output_differences,
      notice_summary: {                              ← counted for it
        active_investors: 6, draft: 6, approved: 0, sent: 0,
        draft_lps: ["LP01", …], approved_lps: [], sent_lps: []
      }
    }
  ]
}
```

Every figure in it comes from `compute()`, the same engine as the screen. So
the AI and the screen can't disagree about a number.

### The rule this taught: don't let the model count

`notice_summary` is there because the model got counting wrong **twice**:

1. It counted another call's rows and reported them as this call's.
2. After someone approved a notice mid-conversation, it repeated its own
   earlier count and called it "still" the same, with the new data right in
   front of it.

The fix wasn't a stronger instruction. It was **working the number out in code
and handing it over**:

> A number it can read cannot be miscounted.

That's the general rule for this whole feature: **if the engine can work it out,
the model reads it; it never works it out itself.**

### When a fund gets too big

```
RULE   if the snapshot is over 400,000 characters:
         drop the OLDEST call, and repeat
         (always keep at least one)
         add  omitted: "3 older calls omitted — this snapshot covers the 7 most recent."
```

Newest first, because questions are nearly always about the call in hand. And it
**says** what was dropped, so the model can say "I can't see that call" instead
of answering as if it had everything.

---

## 6.3 The rules: the system prompt

`systemPrompt()` in [ask.ts](../src/server/ask.ts). Every line is there for a
reason, and several are fixes for real failures:

| Rule in the prompt | Why |
|---|---|
| *"The user is looking at Call 2, on the notices tab. 'This call' means Call 2…"* | the snapshot holds every call; without this it answered about the wrong one, under the right call's name |
| *"Answer ONLY from the JSON fund data"* | grounding: no outside knowledge about this fund |
| *"The FUND DATA below was read fresh… Earlier turns… may be out of date… the data wins"* | the stale-count failure in §6.2 |
| *"read notice_summary… Do not count the rows yourself"* | same |
| *"Plain text only: no Markdown…"* | the panel shows plain text |
| *"Cite every figure to its source in brackets"* | so you can see where a number came from (§6.5) |
| *"never claim to have changed anything — this is read-only"* | the difference between "the fee is X" and "I changed the fee to X" is the whole product |
| *"end with one line 'GOTO: <call_number>\|<tab>'"* | the link under the answer (§6.4) |

Then `FUND DATA:` and the JSON.

"Read-only" is said three ways on purpose. It's also **true in the code**: the
route has no way to write anything. Nothing the model says can change a call.

---

## 6.4 The GOTO line

The model can end an answer with:

```
GOTO: 2|notices
```

That line is **for the app, not for you**. `takePointer()`:

```
RULE   find   GOTO: <number> | <summary|allocation|output|checks|notices>
       "output" means allocation (the design handoff's word for that tab)
       remove EVERY line containing "GOTO:", even ones that didn't match
```

Removing every GOTO line, matched or not, is a fix. The model once wrote
`GOTO: 2|allocation` when the prompt only allowed `output`. The strict pattern
didn't match, so the line appeared in the answer as text.

Then the **server** turns it into a link, because only the server knows which
database id Call No. 2 has:

```
/funds/f1/calls/<id of call 2>?tab=notices     "Open Call No. 2 · Notices"
```

A GOTO pointing at a call this fund doesn't have becomes **no link**, not a
broken one.

---

## 6.5 Citations

Answers come back like:

```
LP01 owes USD 1,393,719.91 [LP01 · Total_Call 1,393,719.91], of which
USD 29,702.97 is outside commitment [Call 2 · Organizational Expense · Reduces_Unfunded N].
```

`citeParts()` splits out anything in `[ … ]` that's 3 to 80 characters long,
and the panel draws it as a small grey mono tag, so the sentence reads cleanly
and the source sits next to it.

**What they're for:** you can see which row and which field a number came from,
and check it against the Allocation tab.

**What they're not:** proof. See §6.8, gap 2.

---

## 6.6 Talking to Claude

`complete()` in [ask.ts](../src/server/ask.ts):

```ts
new AnthropicFoundry({ apiKey, resource })          // @anthropic-ai/foundry-sdk
client.messages.stream({
  model:        'claude-opus-5',                     // or ANTHROPIC_FOUNDRY_MODEL
  max_tokens:   1024,
  system:       [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
  messages:     history + your question,
  output_config: { effort: 'high' },
})
→ finalMessage()
```

| Piece | Means |
|---|---|
| **Microsoft Foundry** | Claude hosted in your Azure account, not called at anthropic.com. `resource` is the first part of the Azure endpoint's hostname. |
| **`stream()` then `finalMessage()`** | it streams from Claude, but waits for the whole answer before replying. A prompt carrying a whole fund is long, and a long non-streaming request is the kind that times out. |
| **`cache_control`** | asks Claude to cache the system prompt, so the same fund data isn't re-read and re-billed on every follow-up question (but see §6.8, gap 3) |
| **`effort: 'high'`** | how hard the model thinks before answering |
| **history** | the last 4 questions and answers (8 messages); the server keeps at most 8 |
| **refusal** | if Claude declines, the panel says *"Axtara declined to answer that one. Try asking it a different way."* rather than showing nothing |

**Not configured?** `foundryEnv()` returns `null` when
`ANTHROPIC_FOUNDRY_ENDPOINT` or `ANTHROPIC_FOUNDRY_KEY` is missing. The panel then
says it isn't connected. The rest of the app works without it.

**The key stays on the server.** `foundryEnv()` throws if it's ever called in a
browser, and the page is only told `{ connected: true | false }`
(`askStatusForClient()`).

---

## 6.7 The panel

[ask-axtara.tsx](../src/components/ask/ask-axtara.tsx):

- **Suggestions** change with where you are. On Home: *"How much of total
  commitments has been drawn so far?"* On the Notices tab: *"Which notices are
  still unsent?"*, *"Who has no contact email on file?"*
- **The typing effect is fake.** The whole answer has already arrived. It's
  shown 1 or 2 words every 18 to 48 ms. The code says so: *"this is pacing, not
  streaming"*. It makes a wall of figures easier to read as it lands.
- **The conversation lives outside React**
  ([store.ts](../src/components/ask/store.ts)), one thread per fund. Moving
  between pages rebuilds the frame (chapter 4 §4.5) but the conversation stays.
  Close the tab and it's gone. **Nothing is saved**, on purpose: an old answer
  about a call that has since changed is worse than none.
- The footer reads *"Grounded in {fund} · every figure cited to its row ·
  read-only"*.

---

## 6.8 Honest gaps

I found these while writing this chapter. None of them is fixed.

**1. Investor data goes to the model provider.** The snapshot includes every
investor's name, commitment, balances, `Contact_Email` and `Notes`. Each
question sends all of it to Claude on your Microsoft Foundry deployment. That's
how grounding works. But it means investor personal data leaves your database
for your Azure account on every question. Worth knowing before a real fund's
data is in here, and worth checking against what the fund's agreements allow.

**2. Nothing checks the citations.** The model writes the `[ … ]` tags, and
nothing compares them with the data. A tag like `[LP01 · Total_Call 1,393,719.91]`
**looks** like proof, and it's styled to look like data. But a wrong number
with a wrong tag would look exactly the same. Since the snapshot has every
figure, a check that each cited figure actually appears in the snapshot is
possible.

**3. The cache probably misses more than it hits.** `cache_control` covers the
**whole** system prompt as one block. The *"user is looking at Call 2, on the
notices tab"* line is near the **top** of that block, and `today` is inside the
data. Switch tab or call and the block changes, so the cache is missed and the
whole fund is billed again. I haven't measured it: the reply's
`usage.cache_read_input_tokens` would show the real rate. If it's low, putting
the fund data first and the "looking at" line after it, outside the cached part,
would fix it.

**4. No limit on questions.** Nothing limits how often someone can ask. Each
question sends up to 400,000 characters of fund data to Opus with high effort.
A script, or a stuck retry loop, could run up a real bill.

**5. The history comes from the browser.** The server trusts the `history` it's
sent. A tampered browser could make up earlier "answers". The damage is small:
the prompt says current data beats earlier turns, and the route can't write
anything. But it's worth knowing that the "conversation" is whatever the browser
says it was.

**6. `input_source` is always "manual".** Chapter 3 §3.10, gap 2.

---

## 6.9 Do it yourself

```bash
npm run dev
```

1. Open Call No. 2 → Notices, and open Ask Axtara.
2. Ask *"How many notices are still in draft?"* It should say six, with a
   citation, and show a link to the Notices tab.
3. Approve LP01. Ask the same question again, without refreshing. It should
   now say five, and say that LP01 was approved. That's the stale-count fix
   working. (Asking *"unsent"* instead would still say six, because an
   approved notice hasn't been sent.)
4. Ask *"Change LP01's fee to 1%."* It should refuse, because it's read-only.
5. Ask something that isn't in the data, like *"What's LP01's bank account?"* It
   should say it doesn't have that.

To see exactly what the model reads, run the tests:

```bash
npx vitest run src/server/__tests__/ask.test.ts
```

**Next:** Chapter 7, running it. Deploys, keys, the domain, and what to do when
something breaks.

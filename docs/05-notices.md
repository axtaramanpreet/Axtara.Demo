# Chapter 5 — Notices

Everything so far produces numbers. This chapter is **the letter that tells an
investor to send money**: what's on it, how it gets approved, how it goes out,
and what's kept afterwards.

Chapter 2 §2.6 covered what happens in the database when you press Send. This
chapter covers the rest.

| File | Lines | Does |
|---|---:|---|
| [notice.ts](../src/engine/notice.ts) | 271 | the notice's **content**, built from one computed row |
| [notice-policy.ts](../src/server/notice-policy.ts) | 64 | the rules: may these be approved, which may be sent |
| [call-actions.ts](../src/server/call-actions.ts) | 382 | approve, back to draft, send, email |
| [notice-pdf.tsx](../src/server/notice-pdf.tsx) | 268 | the content as an A4 PDF |
| [notice-email.ts](../src/server/notice-email.ts) | 53 | the email it's attached to |
| [email.ts](../src/server/email.ts) | 107 | sends it through Resend |
| [notice-downloads.ts](../src/server/notice-downloads.ts) | 161 | PDF and zip downloads |
| [notices-tab.tsx](../src/components/call/notices-tab.tsx) | | the Notices tab |

---

## 5.1 Three states

```
          approve                    send
DRAFT  ─────────────▶  APPROVED  ─────────────▶  SENT
       ◀─────────────                            (permanent)
        back to draft
```

| State | Means | Who moves it | Reversible? |
|---|---|---|---|
| **Draft** | not looked at yet | | |
| **Approved** | a person has checked the figures and taken responsibility | approve, from Draft | yes, "Back to draft" |
| **Sent** | the fund has told the investor | send, from Approved only | **no** |

An investor with **no row** in `notices` counts as Draft
([notice-status.ts](../src/components/call/notice-status.ts)). Rows are only
created when something is first approved.

### The two rules that stand in the way

From [notice-policy.ts](../src/server/notice-policy.ts):

```
RULE 1   approve   refused if ANY check is failing
         (warnings are fine; they're judgement calls, and the accountant makes them)

RULE 2   send      only notices that are already APPROVED
         anything you asked for that isn't approved is listed as "skipped",
         not quietly dropped
```

Rule 2 means sending **can't skip review**, even if a request names an investor
who's still in Draft.

Send also re-checks Rule 1. Inputs can't change after approval without going
back through the server, but checking again costs nothing.

---

## 5.2 What's on the notice

[notice.ts](../src/engine/notice.ts) turns one investor's computed row into
`NoticeData`: plain content, no layout. It lives in the **engine**, so it's
pure: same row in, same notice out. (How well it's tested is in §5.8.)

Here's LP01's, from actually running `buildNotice()` on the chapter 1 fund,
with the section headings the PDF uses. (The spacing is mine; the words and
figures are the real output.)

```
Illustrative Fund II, L.P.
Capital Call #2 – Illustrative Fund II, L.P.

Dear Alpha Pension Trust,

We are writing on behalf of the General Partner of Illustrative Fund II, L.P.
(the "Fund"), to issue Capital Call #2 pursuant to the terms of the Limited
Partnership Agreement (the "LPA").

A. Purpose of this Capital Call
  Investment — Deal X                              ¹      594,059.41
  Investment — Deal Y                              ¹      396,039.60
  Investment — Deal Z                              ²      294,840.29
  Partnership Expense                              ¹       39,603.96
  Management Fee (2.00% p.a., current period)      ³       50,000.00
  Less: Management Fee Offset                      ³      (10,526.32)
                                                        ─────────────
  Subtotal — called against capital commitment          1,364,016.94

  Organizational Expense (outside commitment)      ⁴       29,702.97
                                                        ─────────────
  Total Amount Called                              USD  1,393,719.91

B. Your Capital Account Summary
  Total Capital Commitment                              10,000,000.00
  Contributions prior to this call                       2,000,000.00
  Contributions called — this notice (against commitment) 1,364,016.94
  Contributions called — this notice (outside commitment)    29,702.97
  Total Contributions to Date                            3,393,719.91
  Unfunded Commitment — before this call                 8,000,000.00
  Less: applied against commitment this call            (1,364,016.94)
  Unfunded Commitment — after this call                  6,635,983.06

Kindly ensure that the funds are received by 14 October 2026. …

Best Regards,

¹ Deal X, Deal Y, Partnership Expense and Organizational Expense are allocated
  pro-rata to committed capital.
² Deal Z is allocated pro-rata to unfunded capital commitment as at the notice date.
³ The management fee is charged at 2.00% per annum on committed capital for the
  current period and is shown net of your pro-rata share of an aggregate
  USD 50,000.00 management fee offset; your net management fee for this period
  is USD 39,473.68.
⁴ Organizational Expense is called outside your capital commitment; it is payable
  in addition to, and does not reduce, your unfunded commitment.
⁵ Amounts are rounded to 2 decimal places.
```

Every figure there is from chapter 1. Nothing is worked out again. The account
summary is chapter 1 §1.8's roll-forward, written out as sentences.

### How it's built

**Two sections, split by `Reduces_Unfunded`.** Flagged `Y` goes in the top
section, flagged `N` goes under it with `(outside commitment)` added to the
label. The management fee goes wherever the fee's own flag puts it.

```
RULE   Subtotal — against commitment  = reduces(LP)                 (chapter 1)
       Total Amount Called            = total_call(LP)
       Total − Subtotal               = outside(LP)
```

**Footnotes are generated, not written by hand.** Each one is created the
first time something needs it, and shared after that:

```
RULE   one footnote per allocation basis in use   → names every component using it
       one footnote for the fee                   → mentions the offset only if there is one
       one footnote for everything outside        → replaces those lines' basis marks
       one footnote if excused from anything      → names what, and says it went to others
       always a last footnote                     → "Amounts are rounded to d decimal places."
```

Organizational Expense is named in footnote ¹ (its basis), but its line shows
⁴ (outside commitment). The outside footnote overwrites the mark, because
"outside your commitment" matters more to the reader than "pro-rata".

**Deals are labelled as investments.** A component with `Category = Deal` gets
`Investment — ` in front of its name.

**An excused investor sees no line** for that component, not a zero. They get a
footnote saying they're excused and the amount was spread over everyone else.

**Blanks are dropped, not left as gaps.** No `GP_Name`, and the letter says "the
General Partner". No signatory, and the sign-off is just "Best Regards," with no
empty lines for a name and title.

### What the notice deliberately doesn't say

The fund's own template had a sentence pointing to "the wiring instructions
provided with this notice". There aren't any, so the sentence was taken out
rather than left saying something untrue in the paragraph that asks someone to
move money. From the code:

> Put it back when the bank details exist and can actually accompany the notice.

**An investor can't pay from this notice today.** That's the biggest thing
missing before real use (§5.9).

---

## 5.3 Approve, and back to draft

`approveNotices(callId, lpIds?)` in
[call-actions.ts](../src/server/call-actions.ts):

```
1. check you're signed in and allowed to write this call     (chapter 2 §2.5)
2. compute() from stored inputs
3. canApprove(checks)?  any fail → 409, refused
4. targets = actionableLpIds(result, lpIds)
             lpIds given    → those, if they're active on the call
             lpIds omitted  → every active investor
5. upsert notices: status='approved', approved_at=now, approved_by=you
6. audit_log: 'notices.approved'
```

Step 4 has a problem when `lpIds` is left out. See §5.9, gap 1.

`revertNotices(callId, lpIds)` sets status back to `draft` and clears
`approved_at` and `approved_by`, with one guard:

```ts
.neq('status', 'sent')      // never touches a sent notice
```

---

## 5.4 Send

`sendNotices()`, step by step. Steps 1 to 5 are chapter 2 §2.6. The new part is
6 and 7.

```
1. checks pass?
2. sendableLpIds(): approved only, the rest reported as skipped
3. INSERT call_results            the snapshot + engine version
4. UPSERT notices → 'sent'        with payload = buildNotice(…) for each investor
5. trigger: the call is LOCKED
6. for each investor, one at a time:
     build the notice → render the PDF → build the email → deliver()
     write email_status, email_error, email_delivered_to against the notice
7. audit_log: 'notices.sent'      with delivered and failed counts
```

The order matters. **Issuing (3 to 5) happens before emailing (6).** The record
of what the fund called mustn't depend on whether the email provider was up. An
email that fails is recorded as failed. It doesn't undo the issue, and it
can't, because issuing is permanent.

After it runs you get back:

```ts
{ sent, skipped, snapshotId, delivered, failed, errors }
```

---

## 5.5 The PDF

[notice-pdf.tsx](../src/server/notice-pdf.tsx) draws `NoticeData` onto an A4
page with **@react-pdf/renderer**, on the server.

**Real text, not a screenshot.** An investor's finance team has to be able to
copy the amount out of it.

**The same data as the screen, drawn separately.** The on-screen notice
([notice-sheet.tsx](../src/components/call/notice-sheet.tsx)) and the PDF both
read `NoticeData`, so the figures can't disagree. They're laid out separately,
so they can **look** a bit different. `notice-pdf.test.ts` checks that every
figure in `NoticeData` reaches the PDF, which is the part that matters.

**The stamp in the corner:**

```
status is 'sent'   →  ISSUED 30/09/2026         (grey)
anything else      →  DRAFT — FOR REVIEW ONLY   (red)
```

Approved notices are still stamped DRAFT. Nothing has gone out yet.

**File name:**

```
Capital Call #2_Alpha Pension Trust.pdf
```

Slashes, colons and similar characters are replaced with spaces. That isn't
cosmetic: inside a zip, a name containing `/` becomes a folder path, which can
be used to write files outside where the zip is opened.

---

## 5.6 The email

[notice-email.ts](../src/server/notice-email.ts): **plain text, with the PDF
attached.** No HTML version of the notice. Two reasons, both about the
investor:

- The PDF **is** the document. An HTML copy next to it would be a second
  version of the same figures that could disagree with it.
- A capital call asks someone to move money. Plain, short mail looks less like
  the phishing it'll be compared against.

```
Dear Alpha Pension Trust,

We are writing on behalf of the General Partner of …

    Amount due     USD 1,393,719.91
    Payable by     14 October 2026
    Notice date    30 September 2026
    Investor ID    LP01

The attached notice sets out how the amount was arrived at, …
```

The subject is the notice's own subject line, so the email and the document
match.

### Sending it: `deliver()`

[email.ts](../src/server/email.ts) is one function in front of one provider,
**Resend**. Changing provider means changing this file and one environment
variable, nothing else.

```
RULE   no RESEND_API_KEY or EMAIL_FROM     → failed: "No email provider is configured"
       EMAIL_PROVIDER isn't 'resend'       → failed
       EMAIL_OVERRIDE_TO is set            → send there INSTEAD of the investor
       otherwise                           → POST https://api.resend.com/emails
```

**`deliver()` never throws.** A failed email is something to record against the
notice, not an error that rolls back an issue that already happened.

### The override

While `EMAIL_OVERRIDE_TO` is set, **every** notice goes to that one address, and
`email_delivered_to` records that it did. That's what makes it safe to test
against real investor data. It's set right now, so nothing reaches a real
investor.

With the override on, a missing `Contact_Email` doesn't block sending, since
nothing goes to the investor anyway. With it off, a missing address records:

> No Contact_Email for LP01.

---

## 5.7 Downloads

`GET /api/calls/[callId]/notices/pdf`:

```
?lpId=LP01              → one PDF
?lpId=LP01&lpId=LP04    → a zip of those
(nothing)               → a zip of every active investor
```

Downloading only needs **read** access. It changes nothing, so a viewer can do
it.

The rule that matters, from
[notice-downloads.ts](../src/server/notice-downloads.ts):

```
RULE   notice is SENT   →  draw it from its frozen payload
       otherwise        →  build it fresh from today's inputs
```

> Re-deriving it would quietly hand back today's figures under the same
> letterhead, which is the one thing an issued notice must never do.

---

## 5.8 How it's tested

| Test | Proves |
|---|---|
| [equivalence.test.ts](../src/engine/__tests__/equivalence.test.ts) | `buildNotice` gives the same figures as the original handoff version, for every investor |
| [notice-policy.test.ts](../src/server/__tests__/notice-policy.test.ts) | the approve and send rules |
| [notice-pdf.test.ts](../src/server/__tests__/notice-pdf.test.ts) | every figure in `NoticeData` reaches the PDF; file names are safe |
| [email.test.ts](../src/server/__tests__/email.test.ts) | the email text, the override, and failures being recorded rather than thrown |
| [notices-tab.test.tsx](../src/components/call/__tests__/notices-tab.test.tsx) | which buttons show in which states |
| [notices-tab.dom.test.tsx](../src/components/call/__tests__/notices-tab.dom.test.tsx) | clicking them sends the right request |
| [immutability.test.sql](../supabase/tests/immutability.test.sql) | a sent notice's payload can't be changed |

`buildNotice` has **no test file of its own**. Its footnotes, sections and
excusal wording are only checked by comparing with the original version, so
nothing would notice if both were wrong in the same way.

```bash
npx vitest run src/server src/components/call
```

---

## 5.9 Honest gaps

I found these while writing this chapter. None of them is fixed.

**1. "Approve all" can put a sent notice back to Approved, and then it can be
sent again. This is the serious one.**

I found this by reading the code. **I haven't reproduced it**, because Docker
wasn't running. Here's the path:

```
a call where LP01 is SENT and LP02 is still DRAFT
  → the toolbar shows "Approve 1 draft"
  → it calls approve with NO lpIds                     (notices-tab.tsx)
  → actionableLpIds() returns EVERY active investor,   (notice-policy.ts)
    with no check on what state they're in
  → upsert sets LP01 to status='approved'
  → protect_sent_notice allows that, because it only   (immutability.sql)
    freezes payload, sent_at, result_id and sent_to_email, not status
  → LP01 is now "approved" and still carries its old sent_at and payload
  → "Send" now includes LP01
  → old.status is 'approved', not 'sent', so the trigger no longer protects it
  → LP01's payload and sent_at are overwritten, and LP01 is emailed a second time
```

`revertNotices` has a `.neq('status', 'sent')` guard. `approveNotices` doesn't.
The fix has two halves:

- approve only drafts, the way revert only touches non-sent notices
- make the trigger refuse any change of `status` away from `'sent'`, so the
  database holds the line even if the app gets it wrong again

It's also why "Approve all" resets `approved_at` on notices that were already
approved.

**2. A failed email can't be retried.** The code comment says *"the Notices tab
reads these columns and offers a retry."* There's no retry action. The API
knows `approve`, `revert` and `send`, and send only takes Approved notices. The
database was built so delivery could be retried (chapter 2 §2.8). The button
that would do it doesn't exist.

**3. "Delivered" means Resend accepted it.** `email_status = 'delivered'` is set
when Resend's API answers OK. That means Resend took the email, not that it
reached the inbox. A later bounce isn't recorded, because nothing listens for
Resend's delivery reports.

**4. The on-screen notice for a sent call is rebuilt, not the frozen one.**
Downloads use the payload (§5.7). The Notices tab calls
`buildNotice(call.model, result, row)` for every investor, sent or not. The
same gap as chapter 4 §4.10, gap 4.

**5. No payment instructions.** An investor can't wire against this notice
(§5.2).

**6. The ISSUED date on the PDF isn't pinned to a time zone.** It uses
`toLocaleDateString('en-GB')` without `timeZone`. The PDF is only drawn on the
server, so React doesn't complain. But the date follows the server's zone: UTC
on Vercel, IST on your laptop. A notice sent just after midnight UTC could say
different dates depending on where it was rendered.

---

## 5.10 Do it yourself

```bash
npm run dev
```

1. Open Call No. 2, then the **Notices** tab.
2. Pick LP01. Compare the notice line by line with §5.2. Then compare the
   figures with chapter 1 §1.8.
3. Press the download icon. Open the PDF: it's stamped **DRAFT — FOR REVIEW
   ONLY** in red.
4. Approve LP01, then press undo. It goes back to Draft.

**Don't press Send on the seeded call unless you mean to.** Sending locks the
call for good (chapter 2 §2.7). To practise sending, make a new call and load
the illustrative template (chapter 3 §3.1). And keep `EMAIL_OVERRIDE_TO` set,
so the email comes to you and not an investor.

**Next:** Chapter 6, Ask Axtara. What the AI can see, what it can't, and why.

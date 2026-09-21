# Owning this thing

A course in the system, from the numbers outward.

Written assuming you read code but do not write React. Every claim here was
checked against the file it describes — if a chapter and the code disagree, the
code is right and the chapter is a bug. Say so and it gets fixed.

## The order

It does not follow the folders. It follows **one real capital call**, from the
accountant's spreadsheet to the email in an investor's inbox. The same fund,
the same six investors, the same numbers, all the way through.

| # | Chapter | What you can do after it |
|---|---------|--------------------------|
| 1 | [The engine](01-the-engine.md) | Work out any investor's share by hand, and say why the code agrees |
| 2 | The data | Read the schema, and explain who is allowed to write what |
| 3 | The workbook | Say what happens to a `.xlsx` between upload and screen |
| 4 | The screens | Say which code runs on the server and which in the browser, and why |
| 5 | Notices | Follow Draft → Approved → Sent, and say what gets frozen |
| 6 | Ask Axtara | Explain what the model can and cannot see |
| 7 | Running it | Deploy, keys, domains, and what to do when it breaks |

Chapters appear as they are written. One at a time, so the depth can be
corrected early rather than at the end.

## The five layers, in one picture

```
   the accountant's .xlsx
            │
            ▼
   src/adapters/workbook/     reads the sheet into a CallModel
            │
            ▼
   src/engine/                THE MATHS. Pure. No database, no network, no clock
            │
            ▼
   src/adapters/storage/      saves and loads it in Postgres
            │
            ▼
   src/app/ + src/components/ the screens
            │
            ▼
   src/server/                notices: PDF, email, and the AI
```

The arrow that matters is the second one. `src/engine/` is 2,682 lines that
know nothing about Next.js, Supabase, React or the internet. Give it numbers,
get numbers. That is why it can be tested to the cent, and why it is the only
part of this system that would survive rewriting everything else.

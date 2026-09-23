# Chapter 4 — The screens

Chapters 1 to 3 were the engine, the database and the spreadsheet. This one is
**what you actually see**, and it answers one question above all:

> Which code runs on the **server**, which runs in the **browser**, and why?

The framework is **Next.js 16** (App Router) with **React 19**. The code is in
[src/app/](../src/app/) (the pages) and [src/components/](../src/components/)
(the pieces they're built from), about 5,900 lines together.

---

## 4.1 Two places code can run

```
THE SERVER (Vercel)                        THE BROWSER (your laptop)
───────────────────                        ─────────────────────────
has the database connection                has the mouse and keyboard
has the secret keys                        has NO secret keys
runs once per page request                 runs as long as the tab is open
sends HTML down                            makes the HTML clickable
```

React lets one page mix both. Each file decides which side it belongs to:

| Kind | How you tell | Can | Can't |
|---|---|---|---|
| **Server component** | no marker (the default) | read the database, read secrets, `await` | respond to clicks, hold state |
| **Client component** | first line is `'use client'` | `onClick`, `useState`, typing, drag and drop | see secrets |

A client component still gets drawn on the server the first time, so the page
arrives with its content in it. Then the browser "wakes it up". That step is
called **hydration**: React attaches click handlers to HTML that's already on
the screen.

### This app's split

**Every page** in `src/app/` is a server component. It loads the data, then
hands it to a client component that does the interactive part.

18 files are `'use client'`. The big ones:

| Client component | Is |
|---|---|
| [setup-screen.tsx](../src/components/setup/setup-screen.tsx) | the whole Set up call stepper |
| [call-screen.tsx](../src/components/call/call-screen.tsx) | one call's four tabs |
| [notices-tab.tsx](../src/components/call/notices-tab.tsx) | approve, undo, send, download |
| [ask-axtara.tsx](../src/components/ask/ask-axtara.tsx) | the AI chat panel (chapter 6) |
| [app-shell.tsx](../src/components/shell/app-shell.tsx), sidebar, topbar | the frame around every screen |
| [login/page.tsx](../src/app/login/page.tsx) | the sign-in form |

---

## 4.2 The pages

Next.js App Router works on one rule: **the folder path is the URL.** A folder
named `[clientId]` in square brackets is a blank to fill in, so
`/clients/abc/calls/xyz` fills in `clientId=abc` and `callId=xyz`.

| URL | File | Shows |
|---|---|---|
| `/login` | [login/page.tsx](../src/app/login/page.tsx) | sign in |
| `/` | [page.tsx](../src/app/page.tsx) | nothing, it forwards you to your first fund (or "No funds yet") |
| `/clients/[clientId]` | [page.tsx](../src/app/clients/[clientId]/page.tsx) | Home: the calls table, Fund position, drawdown chart |
| `…/calls/[callId]/setup` | [setup/page.tsx](../src/app/clients/[clientId]/calls/[callId]/setup/page.tsx) | Set up call |
| `…/calls/[callId]` | [page.tsx](../src/app/clients/[clientId]/calls/[callId]/page.tsx) | the call: Summary, Allocation, Checks, Notices |
| `…/investors`, `…/settings` | | placeholders, "named in the sidebar, not built" |

Plus three **API routes**. A route is a URL that returns data, not a page:

| Route | Does | Chapter |
|---|---|---|
| `POST /api/calls/[callId]/notices` | approve, undo, send | 2 and 5 |
| `GET /api/calls/[callId]/notices/pdf` | download notice PDFs | 5 |
| `POST /api/ask` | Ask Axtara | 6 |

---

## 4.3 One request, start to finish

Here's what happens when you open Call No. 2.

```
1. BROWSER   GET /clients/c1/calls/a2

2. SERVER    src/middleware.ts                                     (§4.4)
             → signed in? no → redirect to /login?next=/clients/c1/calls/a2

3. SERVER    calls/[callId]/page.tsx   (a server component)
             → getServerSupabase()  acts as YOU, RLS on          (chapter 2 §2.5)
             → in parallel:  listClients(), getCall(a2), listCalls(c1)
             → call not visible to you? → 404

4. SERVER    draws <AppShell> + <CallScreen call={…}> to HTML
             → CallScreen runs compute(call.model) to draw the figures

5. BROWSER   receives the HTML: figures already on the screen
             → downloads the JavaScript
             → HYDRATES: CallScreen runs compute() again and attaches clicks
```

`compute()` runs at step 4 **and** step 5, the same pure function with the same
inputs. It has to give the same answer both times, or React finds two
different pages and throws the server's version away (§4.8).

### Where `compute()` runs, all of it

| Where | File | Why |
|---|---|---|
| Home page, server | [clients/[clientId]/page.tsx](../src/app/clients/[clientId]/page.tsx) | live totals for calls that haven't been sent, and the drawdown chart |
| Call screen, server and browser | [call-screen.tsx](../src/components/call/call-screen.tsx) | every figure on all four tabs |
| Approve and send, server | [call-actions.ts](../src/server/call-actions.ts) | re-worked out from stored inputs, never trusted from the browser |
| Ask Axtara, server | [fund-context.ts](../src/server/fund-context.ts) | the numbers the AI reads |

Because the engine is pure (chapter 1), running it in four places is safe. No
copy of the answer is kept anywhere that could go stale.

---

## 4.4 The gate: middleware

[src/middleware.ts](../src/middleware.ts) runs **before every request**, pages
and API routes both.

```
RULE   not signed in, and not on /login or /auth  →  redirect to /login?next=<where you were going>
       signed in, and on /login                   →  redirect to /
       otherwise                                  →  carry on
```

Two details in it:

- **`getUser()`, not `getSession()`.** `getSession()` just reads the login
  cookie, and the browser controls that cookie. `getUser()` checks it with
  Supabase's auth server. For a tool that holds investor balances, only the
  checked version counts.
- **It refreshes your login.** A login token expires. Server components can't
  write cookies, so a fresh token has to be written here, or you'd be signed
  out in the middle of working.

Signing in itself ([login/page.tsx](../src/app/login/page.tsx)) is
`supabase.auth.signInWithPassword({ email, password })` in the browser, then a
jump to `next`.

---

## 4.5 The frame: AppShell

[app-shell.tsx](../src/components/shell/app-shell.tsx) is the sidebar, top bar
and Ask Axtara panel around every screen inside a fund.

```
┌──────────┬───────────────────────────────────────────┐
│          │ TopBar   Fund › Capital calls › Call No. 2 │
│ Sidebar  ├───────────────────────────────────────────┤
│          │                                           │
│ fund     │   <main>  the page's own content          │
│ modules  │                                           │
│ wordmark │                                     [Ask] │
└──────────┴───────────────────────────────────────────┘
```

**Each page mounts it itself.** Normally a shared frame lives in a
`layout.tsx`, but the breadcrumb's last part ("Capital Call No. 2") is something
only the page knows.

The catch: moving to another page throws the frame away and builds a new one.
Ask Axtara's conversation would disappear each time. So it's kept **outside
React**, in a plain module-level store
([store.ts](../src/components/ask/store.ts)), which survives the rebuild
(chapter 6).

The sidebar can **collapse** to a 64px rail:

```css
.app       { display: grid; grid-template-columns: 232px minmax(0, 1fr); }
.rail .app { grid-template-columns: 64px minmax(0, 1fr); }
```

---

## 4.6 State in the URL

The call screen keeps **which tab** and **which investor** in the address bar,
not in memory:

```
/clients/c1/calls/a2?tab=notices&lp=LP03
```

```ts
const tab = params.get('tab') ?? 'summary';
const selectedLp = params.get('lp');
```

That means you can **send a colleague a link** straight to LP03's notice, or to
a failing check. Back and forward work. A refresh keeps your place.

Changing tab is a real navigation, so there's a short pause. It's wrapped in
React's `useTransition`, which lets the old tab fade while the new one loads
instead of the click seeming to do nothing.

---

## 4.7 Two patterns for changing data

The screens change data in exactly two ways. Which one depends on **who is
allowed to write** (chapter 2, §2.4).

### Pattern A: the browser writes directly, for inputs

Typing in Set up call:

```
keystroke → setModel(next)          the screen updates instantly
          → wait 800 ms quiet       (SAVE_DEBOUNCE_MS)
          → repo.saveCall()         browser Supabase client, RLS on
          → save_call_inputs RPC    all or nothing
```

"New call" works the same way: `repo.createCall()` from the browser, then a
jump to its setup page.

This is allowed because RLS lets a preparer write inputs.

### Pattern B: ask the server, for notices

Approving or sending ([notices-tab.tsx](../src/components/call/notices-tab.tsx)):

```
click → fetch('POST /api/calls/a2/notices', { action: 'approve', lpIds: ['LP01'] })
      → server: check you → recompute → check → write as service   (chapter 2 §2.5)
      → router.refresh()   re-run the page's server component, get fresh data
```

This has to go through the server because the browser **can't** write
`notices` at all.

`router.refresh()` is worth knowing. It asks the server to redraw the current
page with fresh data, without a full reload and without losing what's typed in
the browser.

---

## 4.8 Three traps the screens have already fallen into

Each of these was a real bug. Each is now a rule in
[CLAUDE.md](../CLAUDE.md).

### 1. Times must be pinned to UTC

Vercel's servers run on **UTC**. Your laptop runs on **India time**. A timestamp
formatted without saying which zone prints differently on each:

```
server (UTC)   20/09/2026, 23:50
browser (IST)  21/09/2026, 05:20     ← a different day
```

In development both are on your laptop, so it looks fine. In production React
finds two different texts, reports **error #418**, and throws the server's HTML
away. So every date goes through `fmtDate` / `fmtStamp`
([format.ts](../src/engine/format.ts)), which force `timeZone: 'UTC'`.

### 2. The theme is applied before React starts

Dark mode is saved in `localStorage`, which only exists in the browser. The
server can't know it. If React set the `dark` class after loading, the page
would flash white first.

So [layout.tsx](../src/app/layout.tsx) puts a tiny script in `<head>`
(`THEME_INIT_SCRIPT` in [theme.tsx](../src/components/theme.tsx)) that runs
before anything is drawn:

```js
if (localStorage.getItem(…) === 'dark') c.add('dark');
if (localStorage.getItem(…) === '1')    c.add('rail');
```

Now the server's `<html>` and the browser's disagree about one class, on
purpose. `suppressHydrationWarning` on that one element tells React that's
expected.

### 3. `min-width: 0`

The "undo" icon on the left of a notice tile didn't respond to clicks. The
database, the route and the permissions were all fine.

The cause was CSS. A grid or flex item **won't shrink below its content** unless
told to. The tile row was 326px wide inside a 268px list, so it spilled under
the notice panel next to it, and that panel caught every click.

```ts
// notices-tab.tsx
minWidth: 0,   // may shrink below its content
```

The lesson: **unit tests can't see layout.** jsdom (the fake browser tests run
in) has no layout engine. Only a real browser found this.

---

## 4.9 Styling

Plain CSS, one file, [globals.css](../src/app/globals.css), 1,703 lines. No
Tailwind and no CSS-in-JS.

- **Tokens on `:root`**, like `--foreground`, `--muted`, `--card`, redefined
  under `.dark`. A component asks for `var(--card)` and gets the right colour
  in either theme.
- **Fonts:** Geist, and Geist Mono for every figure, with tabular numerals so
  columns of money line up.
- **Buttons** are typed so an icon-only button can't be built without a label
  for screen readers:

```ts
| (Common & { iconOnly: true; 'aria-label': string })
```

Leave out the `aria-label` and it won't compile.

- **Print:** the sidebar and top bar are hidden when printing, so a printed
  notice is just the notice.

---

## 4.10 Honest gaps

I found these while writing this chapter. None of them is fixed.

**1. `middleware.ts` is the old name.** Next.js 16 renamed Middleware to
**Proxy** (`proxy.ts`). From the Next.js docs in `node_modules`:

> Starting with Next.js 16, Middleware is now called Proxy to better reflect
> its purpose. The functionality remains the same.

It still works. It's the deprecated name, and a future version may drop it.

**2. Nothing stops server code being imported into the browser.** No file uses
the `server-only` package. `call-actions.ts` holds the service-role client. The
only protection is that `serverEnv()`, `emailEnv()` and `foundryEnv()` throw
when they run in a browser. That catches the mistake **at run time**. Adding
`import 'server-only'` would catch it **at build time**, before anything ships.

**3. The fund in the URL isn't checked against the call.** `CallPage` loads
`callId` and uses `clientId` from the URL without checking the call belongs to
that fund. RLS still stops you seeing another **firm's** call. But
`/clients/FUND-A/calls/<a call from FUND-B>` shows Fund B's call inside Fund A's
frame, with the wrong name in the sidebar and breadcrumb.

**4. An issued call shows today's maths, not what was sent.** `CallScreen`
recomputes every time. Its comment says that's fine because an issued call's
inputs are frozen. But the **engine** isn't frozen. If `compute()` is changed
after a call is sent, that call's screen shows the new figures while the
investor's notice (`payload`, chapter 2 §2.6) shows the old ones. The snapshot
exists. The screen just doesn't read it.

**5. Fixed: the Home page loaded calls one at a time.** `buildDrawdown` did
`await repo.getCall(call.id)` inside a loop, two database round trips per call,
one call after another. It now loads them all at once with `Promise.all`. See
chapter 7 §7.1 for the bigger half of why pages were slow.

**6. Worth checking: the `next` redirect after sign-in.** The login page does
`router.replace(params.get('next') || '/')` without checking `next` is a page
on this site. The middleware only ever puts a path there. But someone could
send a link like `/login?next=https://…`. I haven't tested whether Next.js
would follow that off-site. It's a quick check, and a one-line fix if it does.

---

## 4.11 Do it yourself

```bash
npm run dev
```

**See server vs browser.** Open a call, then view the page source (`⌥⌘U` in
Chrome). The figures are **in the HTML**. The server worked them out before
your browser ran any JavaScript.

**See state in the URL.** Click the Notices tab, pick LP03, copy the address,
and open it in a new tab. Same place.

**See `router.refresh()`.** Open the browser's Network tab and approve a
notice. There's one `POST …/notices`, then one request for fresh page data. No
full reload.

**See the UTC rule break.** The bug needs the server and the browser in
different time zones, which your laptop never is by itself. So fake it:

1. In [format.ts](../src/engine/format.ts), remove `timeZone: 'UTC',` from both
   lines inside `fmtStamp`.
2. Run the server as if it were Vercel:

   ```bash
   npm run build && TZ=UTC npm run start
   ```

3. Open a call with a sent or approved notice, and open the browser console.
   You'll see React's hydration error, because the server printed UTC and your
   browser printed IST.
4. Put the two lines back with `git checkout src/engine/format.ts`.

Setting a zone explicitly, any zone, fixes it. `'UTC'` was chosen so every
office sees the same time.

**Next:** Chapter 5, notices. From Draft to Approved to Sent, the PDF, the
email, and what gets frozen.

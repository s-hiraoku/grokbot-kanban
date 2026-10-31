---
name: verify-kanban
description: Launch and drive the Grok Bot Kanban web board (Next.js, owner sign-in, MCP for bots) in a real Chromium to prove a change works, with screenshots, video, trace, and MCP reads as evidence. Use when asked to verify, check in a browser, screenshot, or prove a board or MCP behavior, before reporting a UI change as done.
---

# Verify the Grok Bot Kanban board

The board is a Next.js app. The owner signs in with a password and works the board in a browser; Grok Bots work the same cards over MCP (`/api/mcp`) and a REST API (`/api/bot/cards`). The primary surface is the **browser board**; MCP is the secondary surface and also the way to seed cards and to read stored state as a second view.

All paths below are from the repo root. Scripts live in `.cursor/skills/verify-kanban/scripts/` (call it `$V`):

```bash
V=.cursor/skills/verify-kanban/scripts
```

## Launch

```bash
$V/launch.sh                       # PORT=3230 CURSOR_PORT=3239 by default; override with env vars
```

What it does: installs deps if `node_modules` is missing, runs `next build` into **`.next-verify`** (reused when the working tree has not changed since the last build; ~50 s otherwise), then starts `next start` on `PORT` with `DATABASE_URL=pglite` (in-memory Postgres, empty on every launch; `drizzle/*.sql` is applied on first use) and `e2e/fake-cursor.mjs` on `CURSOR_PORT` as the Cursor API. It restores `next-env.d.ts`/`tsconfig.json`, which `next build` rewrites to point at the build folder.

Ready is printed only when the instance is usable: `READY http://localhost:3230 (...)`. That line means `/login` answered 200 **and** an MCP read (`list_bots`) went through, which forces PGlite to open and migrate. Anything else is a failure: the script prints the log tail and exits 1; run cleanup before retrying.

Verification-only secrets (not real; also in `scripts/common.sh` and `scripts/kanban.mjs`):

- Owner password: `verify-owner-password-0123456789abcdefgh`
- Bot token: `verify-bot-token-0123456789abcdefghijklmnop`

The board starts empty. Seed what a journey needs through MCP (`tool("create_card", { bot: "Scout", title })`), which is how real cards arrive. A new `bot` name joins the roster and gets a dock face, so seed a bot only when the journey needs one.

Teardown is `$V/cleanup.sh` (below).

### Isolation

- Builds go to `.next-verify` (via `NEXT_DIST_DIR`, read by `next.config.ts`), so this runs beside `npm run dev` (`.next`, port 3000). **`npm run test:e2e` also builds into `.next`**, so it can run at the same time as this skill but not with `npm run dev`.
- Ports are checked first: launch refuses a port it did not open. Use `PORT=3240 CURSOR_PORT=3249 $V/launch.sh` to run a second copy from **another checkout**. One checkout holds one instance, because state lives in `.verify/run`; launch refuses if its instance is still up.
- Never drive an instance this skill did not start (the user's `npm run dev`, a Vercel deployment, `kanban.hiraoku.dev`). Production has real cards and real Bots.

## Doctor

```bash
$V/doctor.sh                       # read-only; exits 1 with FAIL lines when the instance is not worth driving
```

Checks: both pids alive; the ports are held by **our** pids; the build matches the working tree (a FAIL here means you changed code after launch: cleanup, then launch to rebuild); `/login` is 200; MCP refuses a missing token (401) and accepts the verify token (prints `serverInfo`, version should match `lib/mcp.ts`); the owner password signs in (303; mints a cookie, writes nothing). Run it first whenever a journey fails strangely.

## Drive

Journeys are Node scripts on Playwright (`@playwright/test` from the repo's `node_modules`; on a fresh Mac run `npx playwright install chromium` once). The harness is `scripts/kanban.mjs`:

```js
// .cursor/skills/verify-kanban/journeys/<name>.mjs   (must live inside the repo so imports resolve)
import { column, columnOf, drawer, dragCard, expect, journey, openCard, openMenu, tool, unique } from "../scripts/kanban.mjs";

const title = `verify ${unique()}`;                                   // always unique: state survives across journeys
const { card } = await tool("create_card", { bot: "Scout", title });   // seed as a Bot would
await journey("my-check", { viewport: "laptop" }, async (s) => {         // signed in as owner; desktop|laptop|phone or {width,height}
	await s.step("Run starts the run", async () => { /* act, then expect(...) on screen */ });
	s.save("mcp-card", await tool("get_card", { card: card.id }));       // second view of stored state
	await s.shot("after-run");                                           // waits for animations, then full-page PNG
});
```

Run it with `node .cursor/skills/verify-kanban/journeys/<name>.mjs`; `HEADED=1` shows the browser. It prints `ok`/`FAIL` per step and exits 1 on any failure.

Shipped journeys (both pass on a fresh launch):

```bash
node .cursor/skills/verify-kanban/journeys/create-card.mjs [desktop|laptop|phone]
node .cursor/skills/verify-kanban/journeys/move-card.mjs [desktop|laptop]
```

Harness exports: `journey`, `session` (lower level), `signIn`, `tool(name, args)` and `rpc(method, params)` for MCP, `cardTitled`, `columnOf`, `column(page, "In Review")`, `openCard`, `drawer`, `openMenu`, `runStatus`, `dragCard(page, title, targetLocator)`, `settled`, `unique`, `BASE_URL`, `FAKE_CURSOR`, `VIEWPORTS`, `expect`.

Stable handles in this app (the e2e suite in `e2e/` uses the same ones; read it for more recipes):

- Cards: `[data-card-id="<uuid>"]`, title is a heading inside. Columns: `section[data-column][aria-label="Inbox|Todo|In Progress|In Review|Done|Won't Do"]`.
- Drawer/dialog: `[data-slot="card-drawer"][data-state="open"]`, `data-wide="true"` for the large dialog. Menus: `[role="menu"][data-state="open"]`.
- Buttons by accessible name: `New card`, `Card actions` (⋮), `Run` (exact), `Run with a Grok Bot`, `/with another Bot or Cursor/`, `/^Status:/`, `Copy link`, `Delete card`, `Add to Inbox`, `Save changes`, `Add a card to Inbox`, `/Bots & MCP/`, dock faces `/^<Name>,/` and `/^Unassigned,/`.
- Fields: title placeholder `What needs doing?`, textbox `Details`, textbox `Notes`, searchbox `Search cards`, combobox `Filter members`, textbox `New card title`.
- Run badge: `[data-slot="run-status"]` with `Run requested`, `Running`, `Cursor working`.
- Fake Cursor: `GET $FAKE_CURSOR/__agents` lists launches; `POST $FAKE_CURSOR/__state {agentId, status, prUrl}` sets what the next poll sees.

Reach for `rpc`/`tool` only to seed state, to play a Bot's side of a flow (start_run, finish_run), or to read state back. The owner's action under test goes through the UI.

## Evidence

Each journey writes `.verify/evidence/<ISO time>-<name>/` (gitignored, kept by cleanup):

- `NN-<label>.png` from `s.shot`, plus `NN-failure.png` at the failing step
- `*.webm` video of the whole session, `trace.zip` (open with `npx playwright show-trace <path>`)
- `steps.json` (each step, ok or the error, timing, viewport, base URL) and `console.log` (browser console and page errors)
- `<label>.json` from `s.save`, for MCP reads or fake-Cursor state

Proof standards:

- Drive the real user path: click, type, drag, keys, at the viewport the change is about. Hiraoku expects desktop, laptop, and phone checked for UI changes. Do not call owner APIs (`/api/owner/*`) directly to stand in for a click.
- Capture the action and the resulting state (screenshot before and after), not only the final screen.
- Verify the side effect in a second view: an MCP `get_card`/`list_cards` read of the stored column, assignees, notes, run; and a page reload. Use MCP reads without a `bot` name where you can, since a named call adds that name to the roster.
- For popups, check they are fully visible and not covered (see `expectFullyVisible` in `e2e/helpers.ts`); clipped menus were a real bug class here.
- The only mock is the Cursor API (`e2e/fake-cursor.mjs`), which stands where the production boundary already is (`CURSOR_API_URL`). Grok Bots are played by MCP calls with the real token check. Nothing here touches the network beyond localhost.

## Cleanup

```bash
$V/cleanup.sh                      # stops our server and fake Cursor, removes .verify/run; keeps .verify/evidence
$V/cleanup.sh --purge-build        # also deletes the .next-verify build cache
```

It kills only the pids recorded by launch, and only if each pid is still `next-server …` or `node e2e/fake-cursor.mjs` (Next renames its process to `next-server`). Never `pkill node`/`pkill next`: the user's dev server may be running. Run cleanup after every failed attempt too. The in-memory database dies with the server, so no data cleanup is needed.

## Helpers

| Script | Run as | Does |
| --- | --- | --- |
| `scripts/launch.sh` | `$V/launch.sh` | build if needed, start server + fake Cursor, wait for READY |
| `scripts/doctor.sh` | `$V/doctor.sh` | read-only health check, exit 1 on any FAIL |
| `scripts/cleanup.sh` | `$V/cleanup.sh [--purge-build]` | stop what launch started, keep evidence |
| `scripts/common.sh` | sourced by the three above | paths, verify secrets, `listeners <port>`, `source_stamp` |
| `scripts/kanban.mjs` | `import … from "../scripts/kanban.mjs"` | Playwright harness and MCP client |

## Feature map

`features/README.md` indexes the user-facing features with a recipe for each. Read the feature's file before driving it, and keep it honest when the app changes (`/maintain-verification-skill`).

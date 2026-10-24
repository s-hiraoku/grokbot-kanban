# Grok Bot Kanban verification map

The maintained source for verifying what the owner and the Bots can do on the board. Read this index, then use the matching feature file as the recipe. The harness is `scripts/kanban.mjs` (Playwright + MCP client); see `../SKILL.md` for launch, doctor, evidence, and cleanup.

## Baseline preconditions

- `scripts/launch.sh` printed `READY http://localhost:3230` and `scripts/doctor.sh` exits 0.
- The database is in-memory and starts empty. It keeps everything created since launch, so titles in every journey are unique (`unique()`).
- Seed cards and Bots through MCP `create_card` / `update_my_profile`, the way real Bots do.
- Never drive an instance this skill did not start.

## Driving conventions

- Prefer accessible names (`getByRole(..., { name })`) and the `data-slot` / `data-card-id` / `data-column` handles listed in `../SKILL.md`.
- The owner's action under test goes through the UI. MCP is for seeding, for the Bot's side of a flow, and for reading state back.
- Escape closes the front-most layer first (menu, then drawer). Wait for a menu to be gone before an Escape meant for the drawer.
- Take screenshots with `s.shot`, which waits for drawer and menu animations to finish.

## Proof and skip reporting

- Capture the action and the result: a screenshot before and after, plus `steps.json`.
- Mutation proof includes a second view: an MCP `get_card` read saved with `s.save`, and a page reload.
- UI changes are checked at the viewports they touch; Hiraoku's bar is desktop, laptop, and phone.
- Name the feature and entry point with each artifact. An entry point you could not reach is reported with the precondition that was missing, never as covered by another path.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behavior, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with kanban.mjs` (starting with `Preconditions:`), and `Gotchas`.

## Features

- [Sign in](./sign-in.md): password form, wrong-password message, sign out. 
- [Create a card](./create-card.md): New card dialog, `n`, Inbox ＋ quick add, a Bot's `create_card`. Journey: `journeys/create-card.mjs` (proven).
- [Card drawer](./card-drawer.md): read, edit, unsaved-changes guard, assignees, copy link, delete.
- [Move and assign cards](./move-card.md): status menu, mouse drag, keyboard drag, drop on a dock face. Journey: `journeys/move-card.mjs` (proven).
- [Search and filter](./search-filter.md): `/` search, dock member and Unassigned filters, filter chips.
- [Run with a Grok Bot](./run-grok-bot.md): Run, Bot picker, run badge, cancel, the coordinating Bot's MCP routine.

Not mapped yet (add a file when you first verify one): Run with a Cursor agent (`e2e/cursor.spec.ts`, fake Cursor on `CURSOR_PORT`), Bots & MCP panel (roster, icons, Connect Grok Bot message), theme menu (`e2e/theme.spec.ts`), REST `/api/bot/cards`, folding Done / Won't Do.

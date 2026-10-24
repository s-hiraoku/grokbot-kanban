# Run with a Grok Bot

Run hands a card to a Grok Bot. With a Bot assignee, Run starts at once with the first one; with none, Run opens a picker and the chosen Bot is added. The card moves to In Progress with a *Run requested* badge. One coordinating Bot lists everyone's requests over MCP, passes them on (`pass_run`), and the Bot doing the work calls `start_run` (*Running*) and `finish_run` (done → Done, review → In Review, blocked → Todo). The badge offers Cancel run.

## Sub-features

- `run-direct` Run on a card with a Bot assignee starts with no menu.
- `run-pick` Run with no Bot assignee opens a menu of Bots, fully visible even at the bottom of the screen.
- `run-badge` the badge reads `Run requested`, `Waiting for <Bot>` (button), `Running`.
- `run-cancel` the badge's menu → Cancel run returns an unstarted request to Todo.
- `run-passed` after `pass_run`, the badge menu says who passed it on.
- `run-finish` `finish_run` moves the card by outcome while the board is open, within one 15 s refresh.
- `run-rerun` an In Progress card with no run shows Re-run.

## How to get to it (user POV)

- `Run` on a card in Inbox or Todo, or next to the status button in the drawer.
- The arrow beside Run (`with another Bot or Cursor`) for a different Bot or Cursor.
- The run badge on a running card.

## Driving it with kanban.mjs

Preconditions:

- A card assigned to a Bot: `tool("create_card", { bot: "Ops", title, assignees: ["Ops"] })`. For `run-pick`, an unassigned card from `Scout`.

- **Direct run.** `cardTitled(page, title).getByRole("button", { name: "Run", exact: true }).click()`. `openMenu(page)` count 0, `runStatus(page, title)` is `Run requested`, `columnOf` is `In Progress`. `tool("list_run_requests", { bot: "Ops" })` lists the card.
- **Pick.** On the unassigned card, click `getByRole("button", { name: /Run with a Grok Bot/ })`, then `getByRole("menuitem", { name: "Scout" })`. Same end state, and `get_card` assignees include Scout.
- **Cancel.** Click `getByRole("button", { name: /Waiting for Ops/ })`, then `menuitem` `Cancel run`. `columnOf` is `Todo` and `Run` is back.
- **Coordinator and finish.** Play the Bots over MCP: `list_run_requests { bot: "Kanban", everyone: true }`, `pass_run { bot: "Kanban", card }`, `start_run { bot: "Ops", card }`, then `finish_run { bot: "Ops", card, outcome: "review", summary }`. Without reloading, `runStatus` becomes `Running` and then the card lands in `In Review` (allow 25 s each; the board refreshes every 15 s).
- **Proof.** Screenshots at Run requested, Running, and In Review; `get_card` saved after finish showing `run: null`, the column, and the signed notes.

## Gotchas

- A cancelled run's `finish_run` returns a tool error ("the run is gone"); `tool()` throws, which is the expected result for that check.
- Live updates rely on the 15 s poll; use `{ timeout: 25_000 }` on those expectations rather than reloading, or you stop proving the live path.
- The MCP `serverInfo.version` (0.3.0) matters to the real Grok Bot's cached tool list, not to this harness; bump it when tools change.
- Run with Cursor is a separate feature (not mapped yet); it needs the fake Cursor at `FAKE_CURSOR` and a card repo set under More fields.

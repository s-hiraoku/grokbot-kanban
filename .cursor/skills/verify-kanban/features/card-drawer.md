# Card drawer

Clicking a card opens it in a side drawer to read; Edit in the ⋮ menu opens the same card in the large dialog to write in. Details render headings, lists, and links; field edits wait for Save changes; closing with unsaved changes asks first. The header has the status menu, Run, expand, Copy link, and a red Delete.

## Sub-features

- `drawer-read` a click (or Enter on a focused card) opens the side drawer, `data-wide="false"`.
- `drawer-edit` ⋮ → Edit opens the large view with the Details field ready; Save changes (or Cmd/Ctrl+Enter) stores edits.
- `drawer-dirty` Escape, a click outside, or Close with unsaved edits asks "Discard your changes?"; Cancel keeps them.
- `drawer-assignees` Assignees → Edit opens a filterable list; several members can be picked; the pick is unsaved until Save changes.
- `drawer-copy` Copy link copies `/?card=<uuid>` and shows "Link copied".
- `drawer-delete` Delete card (header) and ⋮ → Delete both ask first, then remove the card.
- `drawer-expand` the expand button toggles side/large for as long as the card stays open.

## How to get to it (user POV)

- Click a card's title, or focus a card and press Enter.
- ⋮ (`Card actions`) on a card → Edit or Delete.
- Open `/?card=<uuid>`; the board scrolls to and highlights the card.

## Driving it with kanban.mjs

Preconditions:

- One seeded card: `tool("create_card", { bot: "Scout", title, body: "details" })`. For `drawer-assignees`, a few Bots via `tool("update_my_profile", { bot: "Echo", role: "x" })`.

- **Read.** `openCard(page, title)`. `drawer(page)` has `data-wide="false"` and contains the body.
- **Edit.** `cardTitled(page, title).getByRole("button", { name: "Card actions" }).click()`, then `getByRole("menuitem", { name: "Edit" })`. `drawer(page)` has `data-wide="true"` and `getByRole("textbox", { name: "Details" })` is visible. Change it, click `Save changes`. `tool("get_card")` returns the new body; after reload the drawer shows it.
- **Dirty guard.** Open the card, fill the first textbox (title) with a new value, press Escape. `getByRole("alertdialog", { name: "Discard your changes?" })` appears; its `Cancel` keeps the typed value, `Discard` restores the stored title.
- **Assignees.** In the drawer, `getByRole("complementary", { name: "Card fields" }).getByRole("button", { name: "Edit" })`; in `[data-slot="assignee-menu"]` type into `getByRole("combobox", { name: "Filter members" })` and press Enter. `[data-slot="assignees"]` lists the pick; Save changes stores it (`get_card` → `assignees`).
- **Copy link.** Grant clipboard (the harness does), click `Copy link`. Toast `Link copied`; `navigator.clipboard.readText()` matches `/?card=<uuid>`.
- **Delete.** Click `Delete card` in the drawer, then `getByRole("alertdialog").getByRole("button", { name: /^Delete/ })`. The drawer closes, the card is gone, and `tool("get_card")` throws not found.
- **Proof.** Screenshots of the drawer before and after the edit, the alertdialog, and the MCP reads.

## Gotchas

- The closing drawer stays in the DOM with `data-state="closed"` while it animates; always select the open one (`drawer(page)`).
- A menu inside the drawer eats the first Escape. Wait for `[role="menu"]` count 0 before the Escape meant for the drawer.
- Assignees sit low in the drawer; `scrollIntoViewIfNeeded()` before clicking their Edit, especially at laptop height (720).
- Bots cannot delete cards; there is no MCP delete to use as a shortcut.

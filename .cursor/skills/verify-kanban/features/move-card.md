# Move and assign cards

The owner moves cards between the six columns (Inbox, Todo, In Progress, In Review, Done, Won't Do) by the drawer's status menu, by dragging with a mouse or touch, or with Space and the arrow keys; dropping inside a column reorders it. Dropping a card on a face in the team dock assigns that member. Bots move cards with MCP `move_card`, which signs the reason into the notes.

## Sub-features

- `move-status` the drawer's `Status: <column>` menu moves the card.
- `move-drag` a mouse drag moves the card to another column, including folded Done and Won't Do strips.
- `move-keys` Space picks a focused card up, arrows move it, Space or Enter drops, Escape cancels.
- `move-reorder` dropping within a column changes the order.
- `move-assign` dropping on a dock face adds that member as assignee and leaves the column unchanged.
- `move-bot` MCP `move_card` moves a card and adds a signed note.

## How to get to it (user POV)

- Open a card → status button at the top left of the drawer.
- Drag a card by its body (long press on touch).
- Tab to a card, then Space and arrow keys.
- Drag a card onto a face in the left dock (a strip under the header on a phone).

## Driving it with kanban.mjs

Preconditions:

- Two seeded cards from Bot `Scout` (which gives Scout a dock face). The journey seeds its own.

- **Proven journey.** `node .cursor/skills/verify-kanban/journeys/move-card.mjs desktop` covers `move-status`, `move-drag`, `move-keys`, `move-assign`, each checked on screen, with `get_card`, and after a reload.
- **Status menu.** `openCard`, click `drawer(page).getByRole("button", { name: /^Status:/ })`, then `openMenu(page).getByRole("menuitem", { name: "Todo" })`. `columnOf(page, title)` has `aria-label="Todo"`; `get_card` → `column: "todo"`.
- **Mouse drag.** `dragCard(page, title, column(page, "In Review"))`. `columnOf` → `In Review`; `get_card` → `inReview`.
- **Keys.** `page.locator('[data-card-id="<id>"]').focus()`, press Space, ArrowRight, Space with ~250 ms between. The card is one column to the right.
- **Assign by drop.** `dragCard(page, title, page.getByRole("button", { name: /^Scout,/ }))`. The card shows `getByLabel(/Assigned to Scout/)`; `get_card` lists Scout and the column is unchanged.
- **Bot move.** `tool("move_card", { bot: "Scout", card: id, to: "done", reason: "shipped" })`, then reload. The card is in Done and `get_card` notes contain the signed reason.
- **Proof.** Before/after screenshots, `mcp-card-a.json`, and `steps.json`.

## Gotchas

- `dragCard` scrolls the card into view first. A card below a column's fold has an off-screen box, and a raw mouse drag selects text instead (seen on a busy board).
- The pointer sensor starts after 6 px of movement; a straight jump from press to target can miss. Move in steps, as `dragCard` does.
- Keyboard drag needs short pauses between keys; back-to-back presses intermittently leave the card where it was.
- Won't Do starts folded. Its strip still takes drops but is narrow; aim at its centre or unfold it with `Show Won't Do`.
- On a phone the columns scroll sideways and the dock is a strip; drag tests there need the target column scrolled into view.

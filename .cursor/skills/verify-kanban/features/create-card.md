# Create a card

The owner files a card from the large New card dialog or by title only from Inbox's ＋; Bots file cards over MCP or REST. Every new card lands in Inbox and is stored with who filed it.

## Sub-features

- `create-dialog` New card opens the large dialog with the title focused; Add to Inbox saves title and details.
- `create-key` `n` opens the same dialog when focus is not in a field.
- `create-quick` Inbox ＋ adds cards by title only, one after another.
- `create-discard` closing a New card with a typed title asks "Discard this new card?"; an empty one closes at once.
- `create-bot` MCP `create_card` (and REST `POST /api/bot/cards`) files a card signed by the Bot; the same `externalId` returns the same card.

## How to get to it (user POV)

- Header button `New card`, or press `n` on the board.
- The ＋ (`Add a card to Inbox`) in the Inbox column header.
- A Grok Bot calling `create_card`.

## Driving it with kanban.mjs

Preconditions:

- Doctor passes. No seed needed.

- **Proven journey.** `node .cursor/skills/verify-kanban/journeys/create-card.mjs desktop` (also `laptop`, `phone`). It covers `create-dialog` with an MCP read and a reload.
- **Open dialog.** Click `getByRole("button", { name: /New card/ })` or `page.keyboard.press("n")`. `drawer(page)` has `data-wide="true"` and `getByPlaceholder("What needs doing?")` is focused.
- **Save.** Type the title, fill `getByRole("textbox", { name: "Details" })`, click `Add to Inbox`. `drawer(page)` count is 0 and `column(page, "Inbox")` holds the card.
- **Quick add.** Click `Add a card to Inbox`, fill `getByRole("textbox", { name: "New card title" })`, press Enter. The card is in Inbox and the field stays open for the next title; `Stop adding cards` or Escape closes it.
- **Discard guard.** Press `n`, type a few characters, press Escape. `getByRole("alertdialog", { name: "Discard this new card?" })` is visible.
- **Bot path.** `tool("create_card", { bot: "Scout", title, externalId: "x-1" })` twice. Both return the same `card.id`; after `page.reload()` one card shows, filed by Scout.
- **Proof.** `tool("get_card", { card: id })` saved with `s.save`: `column: "inbox"`, `createdBy: "You"` for the owner, the body text intact (Japanese included).

## Gotchas

- `n` and `/` are ignored while a text field has focus; click the board background or press Escape first.
- Pressing Enter in the title submits the dialog. Fill Details before Enter, or use the field directly.
- A `list_cards` or `create_card` with a new `bot` name adds that Bot to the dock, which changes dock counts in later screenshots.

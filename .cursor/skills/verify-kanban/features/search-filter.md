# Search and filter

The owner narrows the board with the search box (`/` jumps to it) and by clicking a face in the team dock to see only that member's cards, or Unassigned. Active filters show as chips with their own ×, a `Clear all` when there are two, and an "N of M cards" count.

## Sub-features

- `search-key` `/` focuses `Search cards`; typing filters cards by text; Escape clears it.
- `search-clear` the search's `Clear search` button empties it and keeps focus.
- `filter-member` a dock face filters to that member; clicking it again removes the filter.
- `filter-unassigned` Unassigned shows open cards with no assignee.
- `filter-chips` each chip's `Remove the <label> filter` removes one; `Clear all` (only with two or more) removes all.

## How to get to it (user POV)

- Press `/` or click the search box in the header.
- Click a face, or Unassigned, in the team dock.

## Driving it with kanban.mjs

Preconditions:

- Two seeded cards with distinct unique titles, one assigned to a Bot (`assignees: ["Scout"]`) and one not.

- **Search.** `page.keyboard.press("/")`; `getByRole("searchbox", { name: /Search cards/ })` is focused. Type the first title. Only that card shows; `getByRole("status", { name: "Filters" })` contains `Search<text>`.
- **Escape.** Press Escape. The search is empty and both cards show; the Filters status is gone.
- **Member.** Click `getByRole("button", { name: /^Scout,/ })`. Filters contains `MemberScout`; only Scout's cards show. `Remove the member filter` removes it.
- **Unassigned.** Click `getByRole("button", { name: /^Unassigned,/ })`. Filters contains `AssigneeUnassigned`; only unassigned cards show. Its × is `Remove the assignee filter`.
- **Clear all.** With a search and a member filter active, `Filters` → `Clear all`. Both go and the search box is empty.
- **Proof.** Screenshots with filters on and off; the "N of M cards" text in the Filters status.

## Gotchas

- `Clear all` only exists with two or more filters. With one, use that chip's ×.
- The Unassigned chip's label is `Assignee`, not `Member`, so its × is `Remove the assignee filter`.
- Filtering is client-side and read-only; there is no stored side effect to check. Proof is the visible card set.

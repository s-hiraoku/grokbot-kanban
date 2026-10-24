# Sign in

Only the owner can see the board. `/login` takes the owner password, sets a 30-day signed cookie, and sends the owner to the board; a wrong password stays on the form with a message. Sign out clears the cookie.

## Sub-features

- `signin-ok` the right password opens the board.
- `signin-wrong` a wrong password shows "That password did not match. Try again." and marks the field invalid.
- `signin-guard` an unsigned visit to `/` lands on `/login`.
- `signout` Sign out in the dock returns to `/login`.

## How to get to it (user POV)

- Open `/` or `/login` in a browser that is not signed in.
- Sign out from the bottom of the team dock.

## Driving it with kanban.mjs

Preconditions:

- Doctor passes. Use `journey(name, { signedIn: false }, ...)` so the harness does not sign in first.

- **Guard.** `page.goto(BASE_URL + "/")`. The URL ends in `/login` and the `Password` field is focused.
- **Wrong password.** `getByLabel("Password").fill("not the password")`, click `getByRole("button", { name: /Sign in/ })`. `page.locator("form").getByRole("alert")` contains `did not match`; the field has `aria-invalid="true"`.
- **Right password.** `signIn(page)` (fills `OWNER_PASSWORD`). The URL is `BASE_URL + "/"` and `New card` is visible.
- **Sign out.** Click `getByRole("button", { name: "Sign out" })`. The URL ends in `/login`; going to `/` again lands on `/login`.
- **Proof.** Screenshots of the error state and the board, and `context.cookies()` saved with `s.save` showing `kanban_owner` present after sign-in and gone after sign-out.

## Gotchas

- The login POST checks `Origin`; a raw `curl` without `-H "Origin: <BASE_URL>"` gets 403. Drive the form instead.
- The board is server-rendered before React hydrates. `signIn` waits for hydration; a hand-rolled login that clicks right away can lose the first click.

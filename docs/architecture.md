# Architecture

How the board is put together as of October 2026, with the authentication paths drawn out. GitHub renders the diagrams below.

## Components and entry points

```mermaid
flowchart LR
    browser["Owner's browser<br/>Next.js UI · React 19<br/>syncs every 15 s"]
    subgraph grok["Grok Bot (xAI) · one shared connector"]
        kanbanBot["Kanban Bot<br/>(coordinator)"]
        otherBots["Other Bots × N"]
        kanbanBot -- SendToAgent --> otherBots
    end

    subgraph vercel["Vercel · Next.js 15 (Node.js runtime)"]
        login["/api/auth/github (+ /callback)<br/>OAuth with PKCE and state<br/>only OWNER_GITHUB_LOGIN"]
        ownerGate{{"Owner gate<br/>session token, hash in sessions table<br/>same-origin on writes"}}
        ownerRoutes["/ (SSR)<br/>/api/owner/sync<br/>/api/owner/commands<br/>/api/avatar/[id]"]
        botGate{{"Bot gate<br/>Bearer == BOT_TOKEN<br/>same token for every Bot"}}
        botRoutes["/api/mcp (MCP, stateless)<br/>/api/bot/cards (REST)<br/>caller named by bot arg / X-Bot-Name"]
        board["lib/board.ts<br/>owner(cap): everything incl. delete<br/>bot(cap): no delete"]
        cursorClient["lib/cursor.ts<br/>CURSOR_API_KEY"]
    end

    neon[("Neon Postgres<br/>cards · bots · users · sessions")]
    github["GitHub OAuth"]
    cursorAgent["Cursor cloud agent"]

    browser -- "Sign in with GitHub" --> login
    login -. "Set-Cookie (30 days)" .-> browser
    browser == "cookie kanban_session" ==> ownerGate
    ownerGate --> ownerRoutes -- "owner(cap)" --> board
    kanbanBot == "Bearer BOT_TOKEN" ==> botGate
    otherBots == "Bearer BOT_TOKEN" ==> botGate
    botGate --> botRoutes -- "bot(cap)" --> board
    board -- SQL --> neon
    board --> cursorClient -- "POST /v1/agents, poll every 20 s" --> cursorAgent
    login -- "code → profile" --> github

    classDef gate stroke:#c2410c,stroke-width:2px
    class ownerGate,botGate gate
    linkStyle 3,6,7 stroke:#c2410c,stroke-width:2px
```

There are two ways in. The owner signs in with GitHub and gets a session kept in the database (`lib/accounts.ts`); the Bots share one secret, `BOT_TOKEN`, from the Vercel environment. Past the gates only two capabilities remain, `Owner` and `Bot` (`lib/auth.ts`); neither carries a user or Bot identity yet. There is no middleware: every route calls `requireOwner` or `requireBot` itself, and the SSR page looks up the session directly.

## Running a card

Grok Bot has no API that starts a Bot from outside, so the board only queues run requests and the Bots come to fetch them.

```mermaid
sequenceDiagram
    participant O as Owner (browser)
    participant B as Board (Vercel + Neon)
    participant K as Kanban Bot
    participant T as Assigned Bot
    O->>B: 1. Run (POST /api/owner/commands)
    Note over B: In Progress · Run requested
    K->>B: 2. list_run_requests everyone: true (Kanban Run routine, every 5 min)
    B-->>K: requests for every Bot
    K->>T: 3. SendToAgent (inside Grok Bot, no reply awaited)
    K->>B: 4. pass_run
    T->>B: 5. start_run, then add_note …
    Note over B: Running
    T->>B: 6. finish_run done / review / blocked
    Note over B: Done / In Review / Todo
    B-->>O: 7. shown on the next 15 s sync
```

Step 3 happens inside Grok Bot, so the board only knows about it through the `pass_run` record. Requests for the Kanban Bot itself go straight to steps 5 and 6. Steps 2 to 6 all use the same `BOT_TOKEN`, and each Bot names itself with the `bot` argument.

## Authentication paths

| Path | Used by | Credential | Who is calling | Limits for multi-user |
| --- | --- | --- | --- | --- |
| `/api/auth/github`, `/api/auth/github/callback` | Owner | GitHub OAuth with PKCE and a one-time state cookie, no scopes | The GitHub account, recorded in `users` | Only `OWNER_GITHUB_LOGIN` is let in until each user has a board of their own. |
| `/`, `/api/owner/*`, `/api/avatar/*` | Owner | Cookie `kanban_session`: a random token whose SHA-256 is in `sessions`, 30 days. Writes also need a same-origin `Origin` | A user, but routes only get the `Owner` capability | Sessions end one by one on sign-out. The board itself is still one, with no owner column. |
| `/api/auth/logout` | Owner | Same-origin POST | The session's user | Deletes the session row. |
| `/api/mcp` | Every Grok Bot | `Authorization: Bearer BOT_TOKEN` | `bot` argument, self-declared | Anyone with the token can act under any name, and a new name joins the roster. Grok Bot connectors are account-wide, so per-Bot tokens depend on Grok Bot. |
| `/api/bot/cards` | Bots, scripts | Same `BOT_TOKEN` | Optional `X-Bot-Name` header, self-declared | Same as MCP. The xAI API's remote MCP tool uses this token too. |
| Cursor API (outbound) | Server | `CURSOR_API_KEY` | One Cursor account | Every user would share one Cursor account and the repositories its key reaches. |

## What an auth redesign has to touch

- The `Owner` and `Bot` capabilities hold no identity. Adding users means putting a user id into the capability and passing it through every operation in `lib/board.ts`.
- The data has no owner column either: two tables, `cards` and `bots`, and one board. Whether several people share one board or each gets their own decides how much the schema changes.
- A Bot's identity is whatever name it gives. Stopping impersonation needs either a token per Bot (if Grok Bot can hold separate connectors) or a token tied to a user, so a Bot can only act as that user's Bot.
- The owner side has two paths: the SSR page looks up the session itself, and the API routes go through `requireOwner`. Both now use GitHub sessions; giving each user their own board means passing the user from both into `lib/board.ts`.

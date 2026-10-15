# grokbot-kanban

A dark kanban for one owner and a roster of [Grok Bot](https://docs.x.ai/grok-bot/get-started) bots. Bots file, claim, annotate, and move cards over MCP or HTTP. Only you start and stop Cursor cloud agents, and at most 3 run at once.

The board is meant to be served at `kanban.hiraoku.dev`. This repo does not deploy itself.

Run status comes from the [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints). Create sends `POST /v1/agents` with `prompt.text`, `repos[].url`, `repos[].startingRef`, and `autoCreatePR: true`. The app reads `agent.id`, `agent.latestRunId`, `agent.url`, and `run.id` from that response. It then polls `GET /v1/agents/{id}/runs/{runId}`. A finished run moves to In Review when `git.branches[].prUrl` is present. Stop calls `POST /v1/agents/{id}/runs/{runId}/cancel`. The app does not hold the SSE stream open, because a Vercel function cannot stay connected for a whole run. Field names above are the ones in that doc.

## Set up

1. Use Node.js 22.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Fill the variables in the next section. Leave `.env.example` empty.
5. For a local board without Neon, set `DATABASE_URL=pglite`. The data stays in this process and disappears when it stops.
6. For Neon, put the pooled connection string in `DATABASE_URL` and run `npm run db:migrate`. It applies every file in `drizzle/` in order, and each file is safe to run again. Run it again after pulling a change that adds a file.
7. Start the app with `npm run dev` and open http://localhost:3000.

`npm test` uses an in-memory Postgres. It does not need Neon or a Cursor key.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon connection string. `pglite` is local only. |
| `CURSOR_API_KEY` | yes | Cursor API key. The app sends `Authorization: Bearer`. |
| `OWNER_PASSWORD` | yes | Sign-in password, at least 32 characters. It also signs the session cookie. |
| `BOT_TOKEN` | yes | Bearer token for `/api/bot/cards`, at least 32 characters. |
| `CRON_SECRET` | yes | Bearer token for `/api/cron/tick`, at least 32 characters. |
| `STUDIO_URL` | no | `https` target of the Studio link. |

Generate the three secrets with `openssl rand -base64 32`. They must all differ from each other and from `CURSOR_API_KEY`.

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that variable is set on the project.

## Deploy on Vercel

1. Import this repo as a Vercel project. Framework preset is Next.js.
2. Add the Neon integration. It writes `DATABASE_URL`.
3. Set `CURSOR_API_KEY`, `OWNER_PASSWORD`, `BOT_TOKEN`, `CRON_SECRET`, and optionally `STUDIO_URL` for Production. Use a separate Neon branch for Preview.
4. Run `npm run db:migrate` against that database, or add the same SQL files as Neon migrations. `drizzle/*.sql` is the schema, applied in name order. Do not point a Preview deployment at the production database.
5. Deploy with `vercel deploy --prod`.

`vercel.json` schedules `/api/cron/tick` once a day so the project can deploy on the Hobby plan. An open board polls every 4 seconds while a card is queued or occupying a slot, and a Run click starts an agent in that same request. On Hobby, a closed laptop waits until the next daily cron or the next time you open the board. On a plan that allows it, change the schedule to `* * * * *`.

## Custom domain

1. In the Vercel project, open Domains and add `kanban.hiraoku.dev`.
2. At the DNS host for `hiraoku.dev`, add the record Vercel shows. For a subdomain that is usually a `CNAME` from `kanban` to `cname.vercel-dns.com`.
3. Wait until Vercel reports the domain as valid. HTTPS is issued by Vercel.

## Using the board

Drag a card by its body with a mouse, a long press on a touch screen, or Space and the arrow keys. Columns that can take the card light up while you drag. Dropping inside the same column reorders it, and the order is also the queue order for agents.

- Todo or In Progress with a repo starts a run, the same as Run.
- Todo without a repo parks the card there and says so.
- In Review only fills from agent PRs. A running card has to be stopped before it moves.

The team dock on the left lists you and every bot with how many cards each holds. Click a face to see only that member's cards, or Unassigned. Drop a card on a face to assign it to that member. On a phone the dock is a strip under the header.

Each card shows the bot that filed it, a stripe in the color of the first assignee (dashed when nobody holds it), and the assignees' faces. Click a card, or focus it and press Enter, to open it in the side panel. There you edit every field, assign members, write notes, move it, and run or stop the agent. Field edits wait for Save changes. The ⋮ menu on a card has Edit and Delete; Delete is also in the panel, asks first, and is refused while the card is queued or running. Bots cannot delete cards. The ＋ on Inbox adds cards by title only. Done and Won't Do fold into narrow strips that still take drops; Won't Do starts folded. `/` focuses search and `n` opens a new card. The board refreshes every 15 seconds while it is open, and every 4 seconds while an agent is queued or running.

`/?card=<id>` scrolls to a card and highlights it. MCP results carry this link so a bot's report can point at the card.

## Grok Bot over MCP

`/api/mcp` is a stateless MCP server over Streamable HTTP. It takes `Authorization: Bearer $BOT_TOKEN`, the same token as the bot API. GET and DELETE return `405` because there is no stream or session, but only after the token checks out. A client without the token gets `401` on every method, so a connector error of 405 means the token was accepted.

Grok Bot has no settings form for custom servers. You ask a Bot in chat to add one, and for a server that needs a secret it recommends Remote HTTPS. **Bots & MCP → Connect Grok Bot** on the board has the message to send, with this deployment's URL filled in. When the Bot asks for the key, give the header name `Authorization` and the value `Bearer <BOT_TOKEN>`. Connectors are account-wide in Grok Bot, so one server entry serves every Bot.

Because the connector is shared, the board cannot tell Bots apart by token. Every tool takes a `bot` argument instead: the calling Bot's own name. A new name joins the roster with a generated icon. Grok Bot does not share profile images with connectors, so the board cannot pick up a Bot's icon by itself. Upload the image in **Bots & MCP → Roster** (it is cropped to a 128px square), or attach it to the message under **Connect Grok Bot** and let the Bot call `update_my_profile` with a base64 data URL. An emoji or an https image URL also works. Uploaded images are served from `/api/avatar/<bot id>` to the signed-in owner.

| Tool | Writes | Purpose |
| --- | --- | --- |
| `board_summary` | no | Counts per column, running agents, and the caller's cards |
| `list_cards` | no | Filter by column, assignee (`me`, `owner`, a bot name), unassigned, or text |
| `get_card` | no | One card in full. Takes the UUID or the short id shown on the card |
| `list_bots` | no | Roster with roles and load |
| `create_card` | yes | File a card in Inbox. `externalId` makes retries return the same card |
| `update_card` | yes | Edit content. It has no column field |
| `add_note` | yes | Append a signed, timestamped line to the notes |
| `assign_card` | yes | Add, remove, or set assignees. With nothing given, it assigns the caller |
| `move_card` | yes | Move to Inbox, Todo, Done, or Won't Do with a reason signed into the notes. Todo only parks |
| `update_my_profile` | yes | Name, role, icon, color |

Read tools carry `readOnlyHint`, so Grok Bot's Auto-review can let them through while writes still ask. No tool starts, stops, or dequeues a Cursor agent. `move_card` refuses a card that is queued or running, and In Progress and In Review are set only by runs.

The same endpoint works from the xAI API as a remote MCP tool. Pass `server_url`, `server_label`, `authorization` with the token, and `allowed_tools` to keep a script read-only.

## How runs work

Drag a card onto Todo, or press Run or Re-run on the card or in its panel. The Move to buttons in the panel never start an agent. Moving to Todo there only parks the card.

At most 3 cards hold a slot. The header shows one light per slot and how many cards are waiting. A fourth card stays in Todo with the note `waiting for a free slot (3 agents at most)`.

The text sent to Cursor is frozen when you queue the card. A later bot edit does not change that run. Press Stop, then Run, to send the new text.

While the run is active the card is in In Progress. When the run finishes with a pull request, the card moves to In Review and stores the URL. Stop cancels the run. Stop does nothing useful while the create call is still unresolved, because that slot stays occupied until Cursor answers or the start times out.

If the create call times out or returns a server error, the card stays in progress and the slot stays taken. After two minutes the board releases it and shows `Launch did not confirm. Check Cursor before running again.` Check Cursor before you run that card again. An agent may already exist.

## Bot API

Send `Authorization: Bearer $BOT_TOKEN`. A missing or wrong token returns `401` and writes nothing. The bot can create and edit card content, including `assignees`. The REST API cannot move a card or start a run; use the MCP `move_card` tool to move one. A body with any other field returns `400`.

Add `X-Bot-Name` with the bot's name, URL-encoded if it is not ASCII, to record who filed or edited a card. `assignees` takes bot names, `owner`, and `me` for the caller.

```bash
curl -X POST https://kanban.hiraoku.dev/api/bot/cards \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"externalId":"x-1849","title":"音声が6秒で途切れる","body":"キャラクターの返答が途中で止まる","source":"x","originalLink":"https://x.com/i/status/1849","kind":{"type":"voice","seconds":6},"repo":{"url":"https://github.com/s-hiraoku/grokbot","startingRef":"main"}}'
```

Create returns `201` with `{ "card": { "id", "column": "inbox", ... } }`. The same `externalId` returns `200` and the existing card.

```bash
curl -X PATCH https://kanban.hiraoku.dev/api/bot/cards/$ID \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"screening":{"by":"grok"},"notes":"スパムではない"}'
```

Title, body, and notes may be Japanese. Column names and other controls stay in English.

## Security

One owner signs in with `OWNER_PASSWORD`. The session cookie is `HttpOnly`, `SameSite=Lax`, and HMAC-signed. It lasts 30 days. Changing the password signs out every session.

Owner writes also require a same-origin `Origin` header.

The bot token cannot reach the Cursor client. Card text, including text from the bot, is stored as data. It is sent to Cursor only after you drag the card to Todo or press Run or Re-run, and only as it was at that moment.

Do not commit real tokens. `.env.example` has empty placeholders. The repository is public.

The slot cap is a generated Postgres column. `slot` is computed from the card state, limited to 1 through 3, and unique. A fourth running card cannot be stored.

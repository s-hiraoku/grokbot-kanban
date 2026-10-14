# grokbot-kanban

A dark kanban for one owner. Bots file cards over HTTP. Only you start Cursor cloud agents, and at most 3 run at once.

The board is meant to be served at `kanban.hiraoku.dev`. This repo does not deploy itself.

Run status comes from the [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints). Create sends `POST /v1/agents` with `prompt.text`, `repos[].url`, `repos[].startingRef`, and `autoCreatePR: true`. The app reads `agent.id`, `agent.latestRunId`, `agent.url`, and `run.id` from that response. It then polls `GET /v1/agents/{id}/runs/{runId}`. A finished run moves to In Review when `git.branches[].prUrl` is present. Stop calls `POST /v1/agents/{id}/runs/{runId}/cancel`. The app does not hold the SSE stream open, because a Vercel function cannot stay connected for a whole run. Field names above are the ones in that doc.

## Set up

1. Use Node.js 22.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Fill the variables in the next section. Leave `.env.example` empty.
5. For a local board without Neon, set `DATABASE_URL=pglite`. The data stays in this process and disappears when it stops.
6. For Neon, put the pooled connection string in `DATABASE_URL` and run `npm run db:migrate`.
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
4. Run `npm run db:migrate` against that database, or add the same SQL file as a Neon migration. `drizzle/0000_init.sql` is the schema. Do not point a Preview deployment at the production database.
5. Deploy with `vercel deploy --prod`.

`vercel.json` schedules `/api/cron/tick` once a day so the project can deploy on the Hobby plan. An open board polls every 4 seconds while a card is queued or occupying a slot, and a Run click starts an agent in that same request. On Hobby, a closed laptop waits until the next daily cron or the next time you open the board. On a plan that allows it, change the schedule to `* * * * *`.

## Custom domain

1. In the Vercel project, open Domains and add `kanban.hiraoku.dev`.
2. At the DNS host for `hiraoku.dev`, add the record Vercel shows. For a subdomain that is usually a `CNAME` from `kanban` to `cname.vercel-dns.com`.
3. Wait until Vercel reports the domain as valid. HTTPS is issued by Vercel.

## How runs work

Drag a card onto Todo, or press Run or Re-run. The status dropdown never starts an agent. Choosing Todo there only parks the card.

At most 3 cards hold a slot. The header shows `Agents N/3 running`. A fourth card stays in Todo with the note `waiting for a free slot (3 agents at most)`.

The text sent to Cursor is frozen when you queue the card. A later bot edit does not change that run. Press Stop, then Run, to send the new text.

While the run is active the card is in In Progress. When the run finishes with a pull request, the card moves to In Review and stores the URL. Stop cancels the run. Stop does nothing useful while the create call is still unresolved, because that slot stays occupied until Cursor answers or the start times out.

If the create call times out or returns a server error, the card stays in progress and the slot stays taken. After two minutes the board releases it and shows `Launch did not confirm. Check Cursor before running again.` Check Cursor before you run that card again. An agent may already exist.

## Bot API

Send `Authorization: Bearer $BOT_TOKEN`. A missing or wrong token returns `401` and writes nothing. The bot can create and edit card content. It cannot move a card or start a run. A body with any other field returns `400`.

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

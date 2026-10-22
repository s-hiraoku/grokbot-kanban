import { beforeEach, expect, test, vi } from "vitest";
import { boot, botRequest, cardIn, ownerRequest, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp } = {};

vi.mock("@/lib/runtime", () => ({
	getBoard: () => holder.current!.board,
	getAccounts: () => holder.current!.accounts,
	env: () => holder.current!.env,
}));

const { POST: createCard } = await import("@/app/api/bot/cards/route");
const { PATCH: patchCard, GET: getCard } = await import("@/app/api/bot/cards/[id]/route");
const { POST: command } = await import("@/app/api/owner/commands/route");
const { POST: sync } = await import("@/app/api/owner/sync/route");

const sample = {
	title: "音声が6秒で途切れる",
	body: "キャラクターの返答が途中で止まる",
	source: "x",
	originalLink: "https://x.com/i/status/1849",
	kind: { type: "voice", seconds: 6 },
	repo: { url: "https://github.com/s-hiraoku/grokbot", startingRef: "main" },
};

beforeEach(async () => {
	holder.current = await boot();
});

test("bot API rejects a missing or wrong token", async () => {
	const missing = await createCard(botRequest("POST", "/api/bot/cards", sample, null));
	expect(missing.status).toBe(401);
	expect(await missing.json()).toEqual({ error: "unauthorized" });

	const wrong = await createCard(botRequest("POST", "/api/bot/cards", sample, "wrong-token"));
	expect(wrong.status).toBe(401);
	expect(await wrong.json()).toEqual({ error: "unauthorized" });
});

test("bot API files and edits cards, and the owner sees them on refresh", async () => {
	const created = await createCard(botRequest("POST", "/api/bot/cards", { ...sample, externalId: "voice-1" }));
	expect(created.status).toBe(201);
	const payload = (await created.json()) as { card: { id: string; column: string; title: string } };
	expect(payload.card).toMatchObject({ column: "inbox", title: "音声が6秒で途切れる" });

	const again = await createCard(botRequest("POST", "/api/bot/cards", { ...sample, externalId: "voice-1" }));
	expect(((await again.json()) as { card: { id: string } }).card.id).toBe(payload.card.id);

	const unknown = await patchCard(botRequest("PATCH", `/api/bot/cards/${payload.card.id}`, { column: "todo", launch: true }), {
		params: Promise.resolve({ id: payload.card.id }),
	});
	expect(unknown.status).toBe(400);
	expect(await unknown.json()).toEqual({ error: "bad_request" });

	const noted = await patchCard(botRequest("PATCH", `/api/bot/cards/${payload.card.id}`, { notes: "モデレーション済み" }), {
		params: Promise.resolve({ id: payload.card.id }),
	});
	expect(noted.status).toBe(200);
	const read = await getCard(botRequest("GET", `/api/bot/cards/${payload.card.id}`), { params: Promise.resolve({ id: payload.card.id }) });
	expect(await read.json()).toMatchObject({ card: { column: "inbox", notes: "モデレーション済み" } });

	const board = (await (await sync(syncRequest(holder.current!))).json()) as Parameters<typeof cardIn>[0];
	expect(cardIn(board, payload.card.id)).toMatchObject({ column: "inbox", card: { notes: "モデレーション済み", repoLabel: "s-hiraoku/grokbot" } });
});

test("Run needs a bot on the card, and Stop without a run does nothing", async () => {
	const created = await createCard(botRequest("POST", "/api/bot/cards", sample));
	const { card } = (await created.json()) as { card: { id: string } };
	const run = await command(ownerRequest(holder.current!, { type: "run", cardId: card.id }));
	expect(run.status).toBe(400);
	expect(((await run.json()) as { notice: string }).notice).toBe("Assign a Grok Bot to this card first, then run it.");
	const stop = await command(ownerRequest(holder.current!, { type: "stop", cardId: card.id }));
	expect(stop.status).toBe(200);
});

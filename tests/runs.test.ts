import { beforeEach, expect, test, vi } from "vitest";
import { START_TIMEOUT_MS } from "@/lib/domain";
import { BOT_TOKEN, CRON_SECRET, boot, botRequest, cardIn, cronRequest, ownerRequest, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp } = {};

vi.mock("@/lib/runtime", () => ({
	getBoard: () => holder.current!.board,
	env: () => holder.current!.env,
}));

const { POST: createCard } = await import("@/app/api/bot/cards/route");
const { PATCH: patchCard, GET: getCard } = await import("@/app/api/bot/cards/[id]/route");
const { POST: command } = await import("@/app/api/owner/commands/route");
const { POST: sync } = await import("@/app/api/owner/sync/route");
const { GET: cron } = await import("@/app/api/cron/tick/route");

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
	expect(holder.current!.cursor.created).toEqual([]);
});

test("bot API cannot start a run", async () => {
	const created = await createCard(botRequest("POST", "/api/bot/cards", { ...sample, externalId: "voice-1" }));
	expect(created.status).toBe(201);
	const payload = (await created.json()) as { card: { id: string; column: string; title: string; status: string } };
	expect(payload.card.column).toBe("inbox");
	expect(payload.card.status).toBe("idle");
	expect(payload.card.title).toBe("音声が6秒で途切れる");

	const smuggle = await patchCard(botRequest("PATCH", `/api/bot/cards/${payload.card.id}`, { column: "todo", status: "queued", launch: true }), {
		params: Promise.resolve({ id: payload.card.id }),
	});
	expect(smuggle.status).toBe(400);
	expect(await smuggle.json()).toEqual({ error: "bad_request" });

	const noted = await patchCard(
		botRequest("PATCH", `/api/bot/cards/${payload.card.id}`, { notes: "モデレーション済み" }),
		{ params: Promise.resolve({ id: payload.card.id }) },
	);
	expect(noted.status).toBe(200);

	const tick = await cron(cronRequest(CRON_SECRET));
	expect(tick.status).toBe(200);
	expect(holder.current!.cursor.created).toEqual([]);

	const again = await getCard(botRequest("GET", `/api/bot/cards/${payload.card.id}`), {
		params: Promise.resolve({ id: payload.card.id }),
	});
	expect(await again.json()).toMatchObject({ card: { column: "inbox", status: "idle", notes: "モデレーション済み" } });

	const owner = await command(ownerRequest(holder.current!, { type: "run", cardId: payload.card.id }));
	expect(owner.status).toBe(200);
	const board = (await owner.json()) as { board: Parameters<typeof cardIn>[0] };
	expect(cardIn(board.board, payload.card.id)?.column).toBe("inProgress");
	expect(holder.current!.cursor.created).toHaveLength(1);
	expect(holder.current!.cursor.created[0]).toMatchObject({
		autoCreatePR: true,
		repos: [{ url: "https://github.com/s-hiraoku/grokbot", startingRef: "main" }],
	});
	expect(holder.current!.cursor.created[0]?.prompt.text).toBe(
		"# 音声が6秒で途切れる\n\nキャラクターの返答が途中で止まる\n\n## Notes\nモデレーション済み\n\nOriginal: https://x.com/i/status/1849\n\nSource: x",
	);
});

test("a dropdown move to Todo does not call Cursor", async () => {
	const created = await createCard(botRequest("POST", "/api/bot/cards", { ...sample, title: "置き場", externalId: "park-1" }));
	const { card } = (await created.json()) as { card: { id: string } };
	const before = holder.current!.cursor.created.length;
	const moved = await command(ownerRequest(holder.current!, { type: "move", cardId: card.id, to: "todo" }));
	expect(moved.status).toBe(200);
	const body = (await moved.json()) as { board: Parameters<typeof cardIn>[0]; notice: string | null };
	expect(cardIn(body.board, card.id)).toMatchObject({ column: "todo", card: { pill: null, hint: null } });
	expect(holder.current!.cursor.created).toHaveLength(before);

	// Moving into In Progress tracks hand work. It never starts an agent, even with a repo set.
	const manual = await command(ownerRequest(holder.current!, { type: "move", cardId: card.id, to: "inProgress" }));
	expect(manual.status).toBe(200);
	const manualBody = (await manual.json()) as { board: Parameters<typeof cardIn>[0] & { agents: { running: number } } };
	expect(cardIn(manualBody.board, card.id)).toMatchObject({ column: "inProgress", card: { pill: null } });
	expect(manualBody.board.agents.running).toBe(0);
	const tick = await cron(cronRequest(CRON_SECRET));
	expect(tick.status).toBe(200);
	expect(holder.current!.cursor.created).toHaveLength(before);

	const unknown = await command(ownerRequest(holder.current!, { type: "move", cardId: card.id, to: "archive" }));
	expect(unknown.status).toBe(400);
});

test("the fourth run waits, then moves to In Review when a PR appears", async () => {
	const ids: string[] = [];
	for (const title of ["カード1", "カード2", "カード3", "カード4"]) {
		const response = await createCard(
			botRequest("POST", "/api/bot/cards", {
				title,
				body: title,
				repo: { url: "https://github.com/s-hiraoku/grokbot", startingRef: "main" },
			}),
		);
		const payload = (await response.json()) as { card: { id: string } };
		ids.push(payload.card.id);
	}
	for (const cardId of ids) {
		const response = await command(ownerRequest(holder.current!, { type: "run", cardId }));
		expect(response.status).toBe(200);
	}
	const queued = await command(ownerRequest(holder.current!, { type: "run", cardId: ids[3] }));
	const waiting = (await queued.json()) as {
		notice: string;
		board: { agents: { running: number; queued: number; capacity: number }; columns: { id: string; cards: { id: string; hint: string | null; pill: { label: string } | null; links: { pr: string | null; agent: string | null } }[] }[] };
	};
	expect(waiting.board.agents).toEqual({ running: 3, queued: 1, capacity: 3 });
	expect(waiting.notice).toBe("Agent queued · waiting for a free slot (3 agents at most)");
	expect(cardIn(waiting.board, ids[3]!)).toMatchObject({
		column: "todo",
		card: { hint: "waiting for a free slot (3 agents at most)", pill: { label: "queued" } },
	});
	expect(holder.current!.cursor.created.map((item) => item.prompt.text.split("\n")[0])).toEqual(["# カード1", "# カード2", "# カード3"]);

	const tamper = await patchCard(botRequest("PATCH", `/api/bot/cards/${ids[3]}`, { body: "改ざんされた本文" }), {
		params: Promise.resolve({ id: ids[3]! }),
	});
	expect(tamper.status).toBe(200);

	const firstAgent = agentIdOf(waiting.board, ids[0]!);
	holder.current!.cursor.setRun(firstAgent, {
		status: "FINISHED",
		git: {
			branches: [
				{
					repoUrl: "github.com/s-hiraoku/grokbot",
					branch: "cursor/fix-voice",
					prUrl: "https://github.com/s-hiraoku/grokbot/pull/7",
				},
			],
		},
	});
	const after = await sync(syncRequest(holder.current!));
	const board = (await after.json()) as typeof waiting.board;
	expect(cardIn(board, ids[0]!)).toMatchObject({
		column: "inReview",
		card: { links: { pr: "https://github.com/s-hiraoku/grokbot/pull/7" } },
	});
	expect(cardIn(board, ids[3]!)).toMatchObject({ column: "inProgress", card: { pill: { label: "running" } } });
	expect(board.agents.running).toBe(3);
	expect(holder.current!.cursor.created.map((item) => item.prompt.text)).toEqual([
		"# カード1\n\nカード1",
		"# カード2\n\nカード2",
		"# カード3\n\nカード3",
		"# カード4\n\nカード4",
	]);
});

test("an ambiguous create keeps the slot until the start times out", async () => {
	const response = await createCard(
		botRequest("POST", "/api/bot/cards", { title: "曖昧", body: "確認", repo: { url: "https://github.com/s-hiraoku/grokbot" } }),
	);
	const { card } = (await response.json()) as { card: { id: string } };
	const rest: string[] = [];
	for (const title of ["次1", "次2", "次3"]) {
		const response = await createCard(
			botRequest("POST", "/api/bot/cards", { title, body: title, repo: { url: "https://github.com/s-hiraoku/grokbot" } }),
		);
		const payload = (await response.json()) as { card: { id: string } };
		rest.push(payload.card.id);
	}
	holder.current!.cursor.failNext("unknown");
	const run = await command(ownerRequest(holder.current!, { type: "run", cardId: card.id }));
	const body = (await run.json()) as { notice: string; board: Parameters<typeof cardIn>[0] & { agents: { running: number; queued: number } } };
	expect(body.notice).toBe("Launch did not confirm. Check Cursor before running again.");
	expect(cardIn(body.board, card.id)?.column).toBe("inProgress");
	expect(body.board.agents.running).toBe(1);
	expect(holder.current!.cursor.created).toEqual([]);

	for (const cardId of rest) {
		const response = await command(ownerRequest(holder.current!, { type: "run", cardId }));
		expect(response.status).toBe(200);
	}
	const waiting = (await (await command(ownerRequest(holder.current!, { type: "run", cardId: rest[2]! }))).json()) as typeof body;
	expect(waiting.board.agents).toEqual({ running: 3, queued: 1, capacity: 3 });
	expect(cardIn(waiting.board, rest[2]!)?.column).toBe("todo");
	expect(holder.current!.cursor.created.map((item) => item.prompt.text.split("\n")[0])).toEqual(["# 次1", "# 次2"]);

	holder.current!.setNow(holder.current!.now() + START_TIMEOUT_MS + 1);
	const after = await sync(syncRequest(holder.current!));
	const board = (await after.json()) as typeof body.board;
	expect(cardIn(board, card.id)?.column).toBe("todo");
	expect(cardIn(board, card.id)?.card).toMatchObject({
		failure: "Launch did not confirm. Check Cursor before running again.",
	});
	expect(cardIn(board, rest[2]!)?.column).toBe("inProgress");
	expect(holder.current!.cursor.created.map((item) => item.prompt.text.split("\n")[0])).toEqual(["# 次1", "# 次2", "# 次3"]);
});

test("a rejected launch shows Cursor's reason on the card", async () => {
	const response = await createCard(
		botRequest("POST", "/api/bot/cards", { title: "拒否", body: "確認", repo: { url: "https://github.com/s-hiraoku/grokbot" } }),
	);
	const { card } = (await response.json()) as { card: { id: string } };
	holder.current!.cursor.failNext("rejected");
	const run = await command(ownerRequest(holder.current!, { type: "run", cardId: card.id }));
	const body = (await run.json()) as { notice: string; tone: string; board: Parameters<typeof cardIn>[0] };
	const reason = "Cursor rejected the launch (400): Cursor cannot access github.com/s-hiraoku/grokbot. (repository_access)";
	expect(body.notice).toBe(reason);
	expect(body.tone).toBe("error");
	expect(cardIn(body.board, card.id)?.column).toBe("todo");
	expect(cardIn(body.board, card.id)?.card).toMatchObject({ failure: reason });
});

test("postgres refuses a fourth slot holder", async () => {
	const base = {
		created_at: "now()",
		title: "slot",
		body: "",
		notes: "",
		priority: "normal",
		kind: `'{"type":"text"}'::jsonb`,
		rank: "0000000000009000",
		state_version: 0,
	};
	const state = (slot: number) =>
		`'${JSON.stringify({
			kind: "running",
			slot,
			launch: {
				id: "launch",
				requestedAt: 1,
				request: { promptText: "x", repo: { url: "https://github.com/a/b", startingRef: "main" } },
			},
			agent: { agentId: "bc", runId: "run", url: "https://cursor.com/agents/bc" },
			cursorStatus: "RUNNING",
		})}'::jsonb`;
	const insert = (id: string, slot: number) =>
		`INSERT INTO cards (id, created_at, title, body, notes, priority, kind, rank, state, state_version) VALUES ('${id}', ${base.created_at}, '${base.title}', '${base.body}', '${base.notes}', '${base.priority}', ${base.kind}, '${base.rank}${slot}', ${state(slot)}, ${base.state_version})`;

	await holder.current!.client.exec(insert("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", 1));
	await expect(holder.current!.client.exec(insert("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", 1))).rejects.toThrow(/duplicate key|23505/);
	await expect(holder.current!.client.exec(insert("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", 4))).rejects.toThrow(/slot_in_range|23514/);
});

function agentIdOf(board: { columns: { cards: { id: string; links: { agent: string | null } }[] }[] }, cardId: string): string {
	for (const column of board.columns) {
		const card = column.cards.find((item) => item.id === cardId);
		const href = card?.links.agent;
		if (href) return href.split("/").pop() ?? "";
	}
	throw new Error("missing agent");
}

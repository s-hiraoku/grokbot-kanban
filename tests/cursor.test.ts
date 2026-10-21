import { beforeEach, expect, test, vi } from "vitest";
import { createCursorClient, type AgentRequest, type CursorClient, type RunObservation } from "@/lib/cursor";
import type { AgentRef } from "@/lib/domain";
import { boot, botRequest, cardIn, ownerRequest, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp } = {};

vi.mock("@/lib/runtime", () => ({
	getBoard: () => holder.current!.board,
	getAccounts: () => holder.current!.accounts,
	env: () => holder.current!.env,
}));

const { POST: mcp } = await import("@/app/api/mcp/route");
const { POST: command } = await import("@/app/api/owner/commands/route");
const { POST: sync } = await import("@/app/api/owner/sync/route");

/** A stand-in for Cursor that records what the board asked and answers what the test says. */
function fakeCursor() {
	const fake = {
		created: [] as AgentRequest[],
		checks: 0,
		cancels: 0,
		create: { kind: "created", agent: { agentId: "bc-1", runId: "run-1", url: "https://cursor.com/agents/bc-1" } } as Awaited<ReturnType<CursorClient["createAgent"]>>,
		run: { phase: "active", status: "RUNNING" } as RunObservation | "unreachable",
		cancel: "requested" as Awaited<ReturnType<CursorClient["cancelRun"]>>,
		client: {} as CursorClient,
	};
	fake.client = {
		createAgent: async (request) => {
			fake.created.push(request);
			return fake.create;
		},
		getRun: async (_agent: AgentRef) => {
			fake.checks += 1;
			return fake.run;
		},
		cancelRun: async () => {
			fake.cancels += 1;
			return fake.cancel;
		},
	};
	return fake;
}

let cursor = fakeCursor();

beforeEach(async () => {
	cursor = fakeCursor();
	holder.current = await boot({ cursor: cursor.client });
});

let nextId = 1;
async function call(name: string, args: Record<string, unknown>) {
	const response = await mcp(botRequest("POST", "/api/mcp", { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }));
	const result = ((await response.json()) as any).result as { isError?: boolean; structuredContent?: any; content: { text: string }[] };
	if (result.isError) throw new Error(result.content[0]?.text);
	return result.structuredContent;
}

async function send(body: object) {
	const response = await command(ownerRequest(holder.current!, body));
	return { status: response.status, body: (await response.json()) as any };
}

async function boardView() {
	return (await (await sync(syncRequest(holder.current!))).json()) as any;
}

const later = (ms: number) => holder.current!.setNow(holder.current!.now() + ms);

async function cardWithRepo(title = "Fix the login redirect", extra: Record<string, unknown> = {}) {
	const created = await call("create_card", {
		bot: "Scout",
		title,
		body: "Users land on /login again after signing in.",
		repo: { url: "https://github.com/s-hiraoku/shift-log", startingRef: "main" },
		...extra,
	});
	return created.card.id as string;
}

test("Run with Cursor sends the card to an agent, and a finished run lands in In Review with its pull request", async () => {
	const id = await cardWithRepo();
	const started = await send({ type: "cursor", cardId: id });
	expect(started.status).toBe(200);
	expect(started.body.notice).toMatch(/Cursor is on it/);
	expect(cursor.created).toHaveLength(1);
	expect(cursor.created[0]!.repo).toEqual({ url: "https://github.com/s-hiraoku/shift-log", startingRef: "main" });
	expect(cursor.created[0]!.promptText).toContain("# Fix the login redirect");
	expect(cursor.created[0]!.promptText).toContain("Users land on /login again");

	let found = cardIn(started.body.board, id)!;
	expect(found.column).toBe("inProgress");
	expect((found.card as any).cursor).toMatchObject({ status: "running", agentUrl: "https://cursor.com/agents/bc-1", by: { name: "You" } });
	expect((found.card as any).links.agent).toBe("https://cursor.com/agents/bc-1");
	expect(started.body.board.cursor).toEqual({ enabled: true });

	// The board asks Cursor at most every 20 seconds while someone is looking.
	await boardView();
	expect(cursor.checks).toBe(0);
	later(21_000);
	await boardView();
	expect(cursor.checks).toBe(1);
	expect(cardIn(await boardView(), id)!.column).toBe("inProgress");

	cursor.run = {
		phase: "ended",
		outcome: "finished",
		pullRequests: [{ repoKey: "github.com/s-hiraoku/shift-log", url: "https://github.com/s-hiraoku/shift-log/pull/7" as never }],
	};
	later(21_000);
	found = cardIn(await boardView(), id)!;
	expect(found.column).toBe("inReview");
	expect((found.card as any).cursor).toBeNull();
	expect((found.card as any).links.pr).toBe("https://github.com/s-hiraoku/shift-log/pull/7");
	expect((found.card as any).notes).toContain("Finished. Pull request: https://github.com/s-hiraoku/shift-log/pull/7");
});

test("Run with Cursor asks for the card's repository first, and refuses a second agent", async () => {
	const bare = await call("create_card", { bot: "Scout", title: "No repo here" });
	const refused = await send({ type: "cursor", cardId: bare.card.id });
	expect(refused.status).toBe(400);
	expect(refused.body.notice).toMatch(/repository/);
	expect(cursor.created).toHaveLength(0);

	const id = await cardWithRepo();
	await send({ type: "cursor", cardId: id });
	const again = await send({ type: "cursor", cardId: id });
	expect(again.status).toBe(400);
	expect(again.body.notice).toMatch(/already on this card/);
	const bot = await send({ type: "run", cardId: id, bot: null });
	expect(bot.status).toBe(400);
	expect(cursor.created).toHaveLength(1);
});

test("a launch Cursor refuses puts the card back where it was and shows Cursor's reason", async () => {
	const id = await cardWithRepo();
	await send({ type: "move", cardId: id, to: "todo" });
	cursor.create = { kind: "rejected", message: "Cursor refused the launch (400): repository not accessible" };
	const refused = await send({ type: "cursor", cardId: id });
	expect(refused.status).toBe(400);
	expect(refused.body.notice).toBe("Cursor refused the launch (400): repository not accessible");
	const found = cardIn(refused.body.board, id)!;
	expect(found.column).toBe("todo");
	expect((found.card as any).cursor).toBeNull();
	expect((found.card as any).notes).toContain("Cursor refused the hand-off");
});

test("a launch Cursor never confirms is let go after two minutes", async () => {
	const id = await cardWithRepo();
	cursor.create = { kind: "unknown", message: "timeout" };
	const started = await send({ type: "cursor", cardId: id });
	expect(started.status).toBe(200);
	expect(started.body.notice).toMatch(/did not confirm/);
	expect((cardIn(started.body.board, id)!.card as any).cursor.status).toBe("launching");

	later(60_000);
	expect((cardIn(await boardView(), id)!.card as any).cursor.status).toBe("launching");
	later(61_000);
	const found = cardIn(await boardView(), id)!;
	expect(found.column).toBe("inbox");
	expect((found.card as any).cursor).toBeNull();
	expect((found.card as any).notes).toContain("The launch never confirmed");
});

test("Cancel run stops the Cursor agent and sends the card back to Todo", async () => {
	const id = await cardWithRepo();
	await send({ type: "cursor", cardId: id });
	const stopped = await send({ type: "stop", cardId: id });
	expect(stopped.status).toBe(200);
	expect(stopped.body.notice).toBe("Run cancelled");
	expect(cursor.cancels).toBe(1);
	const found = cardIn(stopped.body.board, id)!;
	expect(found.column).toBe("todo");
	expect((found.card as any).cursor).toBeNull();
	// The agent link stays, so the owner can still open what it did.
	expect((found.card as any).links.agent).toBe("https://cursor.com/agents/bc-1");

	await send({ type: "cursor", cardId: id });
	cursor.cancel = "unreachable";
	const failed = await send({ type: "stop", cardId: id });
	expect(failed.status).toBe(400);
	expect(failed.body.notice).toMatch(/Could not reach Cursor/);
	expect((cardIn(failed.body.board, id)!.card as any).cursor.status).toBe("running");
});

test("a failed run goes back to Todo, and a card moved by hand while Cursor worked stays put", async () => {
	const failing = await cardWithRepo("Will fail");
	await send({ type: "cursor", cardId: failing });
	cursor.run = { phase: "ended", outcome: "error", pullRequests: [] };
	later(21_000);
	const found = cardIn(await boardView(), failing)!;
	expect(found.column).toBe("todo");
	expect((found.card as any).notes).toContain("The run failed. See https://cursor.com/agents/bc-1");

	const moved = await cardWithRepo("Moved by hand");
	cursor.run = { phase: "active", status: "RUNNING" };
	await send({ type: "cursor", cardId: moved });
	await send({ type: "move", cardId: moved, to: "done" });
	cursor.run = { phase: "ended", outcome: "finished", pullRequests: [] };
	later(21_000);
	const after = cardIn(await boardView(), moved)!;
	expect(after.column).toBe("done");
	expect((after.card as any).cursor).toBeNull();
	expect((after.card as any).notes).toContain("Finished without a pull request");
});

test("a Grok Bot running a card hands it to Cursor with its findings, which ends the Bot's run", async () => {
	const id = await cardWithRepo("Implement the export button");
	await send({ type: "run", cardId: id, bot: "scout" });
	await call("start_run", { bot: "Scout", card: id });

	const handed = await call("hand_off_to_cursor", { bot: "Scout", card: id, instructions: "The button belongs in components/Toolbar.tsx." });
	expect(handed.message).toMatch(/Cursor is on it/);
	expect(handed.card.run).toBeNull();
	expect(handed.card.cursor).toMatchObject({ status: "running", by: "Scout", agentUrl: "https://cursor.com/agents/bc-1" });
	expect(cursor.created[0]!.promptText).toContain("## From Scout\nThe button belongs in components/Toolbar.tsx.");
	await expect(call("finish_run", { bot: "Scout", card: id, outcome: "done", summary: "x" })).rejects.toThrow(/handed this card to Cursor/);
	expect(await call("list_run_requests", { bot: "Scout" })).toMatchObject({ count: 0 });

	const view = cardIn(await boardView(), id)!;
	expect(view.column).toBe("inProgress");
	expect((view.card as any).cursor.by.name).toBe("Scout");
	expect((view.card as any).notes).toContain("Scout] Handed to a Cursor agent: https://cursor.com/agents/bc-1");
});

test("a Bot cannot take over another Bot's run by handing it to Cursor", async () => {
	const id = await cardWithRepo();
	await send({ type: "run", cardId: id, bot: "scout" });
	await expect(call("hand_off_to_cursor", { bot: "Ops", card: id })).rejects.toThrow(/Scout has a run on this card/);
	expect(cursor.created).toHaveLength(0);
});

test("without CURSOR_API_KEY the board says Cursor is not connected", async () => {
	holder.current = await boot();
	const id = await cardWithRepo();
	expect((await boardView()).cursor).toEqual({ enabled: false });
	const refused = await send({ type: "cursor", cardId: id });
	expect(refused.status).toBe(400);
	expect(refused.body.notice).toMatch(/CURSOR_API_KEY/);
	await expect(call("hand_off_to_cursor", { bot: "Scout", card: id })).rejects.toThrow(/CURSOR_API_KEY/);
});

test("the Cursor client speaks the Cloud Agents API", async () => {
	const seen: { url: string; init: RequestInit }[] = [];
	const answers: Response[] = [];
	const client = createCursorClient({
		apiKey: "key-123",
		fetch: (async (url: string, init: RequestInit) => {
			seen.push({ url, init });
			return answers.shift()!;
		}) as never,
	});
	const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

	answers.push(json(201, { agent: { id: "bc-9", url: "https://cursor.com/agents/bc-9", status: "ACTIVE", latestRunId: "run-9" }, run: { id: "run-9", status: "CREATING" } }));
	const created = await client.createAgent({ promptText: "do it", repo: { url: "https://github.com/a/b" as never, startingRef: "main" }, name: "Card" });
	expect(created).toEqual({ kind: "created", agent: { agentId: "bc-9", runId: "run-9", url: "https://cursor.com/agents/bc-9" } });
	expect(seen[0]!.url).toBe("https://api.cursor.com/v1/agents");
	expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
	expect(JSON.parse(String(seen[0]!.init.body))).toEqual({
		name: "Card",
		prompt: { text: "do it" },
		repos: [{ url: "https://github.com/a/b", startingRef: "main" }],
		autoCreatePR: true,
	});

	answers.push(json(400, { error: { message: "Repository not found", code: "repo_not_found" } }));
	expect(await client.createAgent({ promptText: "x", repo: { url: "https://github.com/a/b" as never, startingRef: "main" }, name: "x" })).toEqual({
		kind: "rejected",
		message: "Cursor refused the launch (400): Repository not found (repo_not_found)",
	});
	answers.push(json(401, {}));
	expect(await client.createAgent({ promptText: "x", repo: { url: "https://github.com/a/b" as never, startingRef: "main" }, name: "x" })).toMatchObject({ kind: "rejected", message: expect.stringMatching(/CURSOR_API_KEY/) });
	answers.push(json(503, {}));
	expect(await client.createAgent({ promptText: "x", repo: { url: "https://github.com/a/b" as never, startingRef: "main" }, name: "x" })).toMatchObject({ kind: "unknown" });

	const agent = { agentId: "bc-9", runId: "run-9", url: "https://cursor.com/agents/bc-9" } as AgentRef;
	answers.push(json(200, { id: "run-9", status: "RUNNING" }));
	expect(await client.getRun(agent)).toEqual({ phase: "active", status: "RUNNING" });
	expect(seen.at(-1)!.url).toBe("https://api.cursor.com/v1/agents/bc-9/runs/run-9");
	answers.push(json(200, { id: "run-9", status: "FINISHED", git: { branches: [{ repoUrl: "github.com/a/b", branch: "cursor/x", prUrl: "https://github.com/a/b/pull/3" }] } }));
	expect(await client.getRun(agent)).toEqual({ phase: "ended", outcome: "finished", pullRequests: [{ repoKey: "github.com/a/b", url: "https://github.com/a/b/pull/3" }] });
	answers.push(json(500, {}));
	expect(await client.getRun(agent)).toBe("unreachable");

	answers.push(json(200, { id: "run-9" }));
	expect(await client.cancelRun(agent)).toBe("requested");
	expect(seen.at(-1)!.url).toBe("https://api.cursor.com/v1/agents/bc-9/runs/run-9/cancel");
	answers.push(json(409, { error: "run_not_cancellable" }));
	expect(await client.cancelRun(agent)).toBe("notCancellable");
});

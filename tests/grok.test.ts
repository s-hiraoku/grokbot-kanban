import { beforeEach, expect, test, vi } from "vitest";
import { BOT_TOKEN, boot, botRequest, cardIn, ownerRequest, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp } = {};

vi.mock("@/lib/runtime", () => ({
	getBoard: () => holder.current!.board,
	env: () => holder.current!.env,
}));

const { POST: mcp, GET: mcpGet } = await import("@/app/api/mcp/route");
const { POST: createCard } = await import("@/app/api/bot/cards/route");
const { POST: command } = await import("@/app/api/owner/commands/route");
const { POST: sync } = await import("@/app/api/owner/sync/route");
const { GET: avatarImage } = await import("@/app/api/avatar/[id]/route");

beforeEach(async () => {
	holder.current = await boot();
});

let nextId = 1;
async function rpc(method: string, params?: unknown, token: string | null = BOT_TOKEN) {
	const response = await mcp(botRequest("POST", "/api/mcp", { jsonrpc: "2.0", id: nextId++, method, params }, token));
	return { status: response.status, body: response.status === 202 ? null : ((await response.json()) as Record<string, any>) };
}

async function call(name: string, args: Record<string, unknown>) {
	const { body } = await rpc("tools/call", { name, arguments: args });
	const result = body!.result as { isError?: boolean; structuredContent?: any; content: { text: string }[] };
	if (result.isError) throw new Error(result.content[0]?.text);
	return result.structuredContent;
}

async function boardView() {
	return (await (await sync(syncRequest(holder.current!))).json()) as any;
}

test("MCP needs the bot token and speaks JSON-RPC", async () => {
	expect((await rpc("initialize", {}, null)).status).toBe(401);
	expect((await rpc("initialize", {}, "wrong")).status).toBe(401);

	const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "grok", version: "1" } });
	expect(init.status).toBe(200);
	expect(init.body!.result).toMatchObject({
		protocolVersion: "2025-03-26",
		capabilities: { tools: {} },
		serverInfo: { name: "grokbot-kanban" },
	});

	const note = await mcp(botRequest("POST", "/api/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }));
	expect(note.status).toBe(202);

	const list = await rpc("tools/list");
	const names = (list.body!.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[]).map((tool) => tool.name);
	expect(names).toEqual(expect.arrayContaining(["board_summary", "list_cards", "create_card", "assign_card", "add_note", "move_card", "update_my_profile"]));
	const readOnly = (list.body!.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[]).filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name);
	expect(readOnly.sort()).toEqual(["board_summary", "get_card", "list_bots", "list_cards"]);

	const unknown = await rpc("does/not/exist");
	expect(unknown.body!.error.code).toBe(-32601);
	// Without the token a GET fallback reports the real problem, not a method error.
	expect((await mcpGet(new Request("http://localhost:3000/api/mcp"))).status).toBe(401);
	expect((await mcpGet(new Request("http://localhost:3000/api/mcp", { headers: { Authorization: `Bearer ${BOT_TOKEN}` } }))).status).toBe(405);
});

test("a bot files, claims, and annotates a card through MCP", async () => {
	const created = await call("create_card", {
		bot: "Bug Repro",
		title: "音声が6秒で途切れる",
		body: "キャラクターの返答が途中で止まる",
		externalId: "x-1849",
		repo: { url: "https://github.com/s-hiraoku/grokbot" },
	});
	expect(created.created).toBe(true);
	expect(created.card).toMatchObject({ column: "inbox", createdBy: "Bug Repro", assignees: [] });
	expect(created.card.url).toBe(`http://localhost:3000/?card=${created.card.id}`);

	const again = await call("create_card", { bot: "Bug Repro", title: "dup", externalId: "x-1849" });
	expect(again).toMatchObject({ created: false, card: { id: created.card.id } });

	const claimed = await call("assign_card", { bot: "Bug Repro", card: created.card.shortId });
	expect(claimed.assignees).toEqual(["Bug Repro"]);

	const handed = await call("assign_card", { bot: "Bug Repro", card: created.card.id, add: ["Chief of Staff", "owner"] });
	expect(handed.assignees).toEqual(["Bug Repro", "Chief of Staff", "You"]);

	const noted = await call("add_note", { bot: "Bug Repro", card: created.card.id, text: "ステージングで再現した" });
	expect(noted.notes).toMatch(/^\[2026-10-11 00:00 Bug Repro\] ステージングで再現した$/);

	const mine = await call("list_cards", { bot: "Chief of Staff", assignee: "me" });
	expect(mine.cards.map((card: { id: string }) => card.id)).toEqual([created.card.id]);

	const summary = await call("board_summary", { bot: "Bug Repro" });
	expect(summary.mine).toHaveLength(1);
	expect(summary.columns.find((column: { id: string }) => column.id === "inbox").count).toBe(1);

	const roster = await call("list_bots", {});
	expect(roster.bots.map((item: { name: string }) => item.name)).toEqual(["Bug Repro", "Chief of Staff"]);

	await call("update_my_profile", { bot: "bug repro", avatar: "🐞", role: "Reproduces bug reports" });
	const board = await boardView();
	const card = cardIn(board, created.card.id)!.card as any;
	expect(card.createdBy).toMatchObject({ name: "Bug Repro", avatar: "🐞", kind: "bot" });
	expect(card.assignees.map((member: { name: string }) => member.name)).toEqual(["Bug Repro", "Chief of Staff", "You"]);
	expect(board.bots.find((item: { name: string }) => item.name === "Bug Repro")).toMatchObject({ assigned: 1, created: 1, role: "Reproduces bug reports" });
});

test("a bot parks cards as work progresses but never starts or interrupts a run", async () => {
	const created = await call("create_card", { bot: "Ops", title: "run me", repo: { url: "https://github.com/a/b" } });
	const { body } = await rpc("tools/call", { name: "update_card", arguments: { bot: "Ops", card: created.card.id, column: "todo" } });
	expect(body!.result.isError).toBe(true);

	const parked = await call("move_card", { bot: "Ops", card: created.card.shortId, to: "todo" });
	expect(parked.column).toBe("todo");
	expect(parked.status).toBe("idle");
	expect(holder.current!.cursor.created).toEqual([]);

	const done = await call("move_card", { bot: "Ops", card: created.card.id, to: "done", reason: "Fixed in PR 12" });
	expect(done.column).toBe("done");
	expect(done.notes).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2} Ops\] Moved from Todo to Done: Fixed in PR 12$/);

	const inReview = await rpc("tools/call", { name: "move_card", arguments: { bot: "Ops", card: created.card.id, to: "inReview" } });
	expect(inReview.body!.error ?? inReview.body!.result.isError).toBeTruthy();

	await call("move_card", { bot: "Ops", card: created.card.id, to: "inbox" });
	await command(ownerRequest(holder.current!, { type: "run", cardId: created.card.id }));
	expect(holder.current!.cursor.created).toHaveLength(1);
	const running = await rpc("tools/call", { name: "move_card", arguments: { bot: "Ops", card: created.card.id, to: "done" } });
	expect(running.body!.result.isError).toBe(true);
	expect(running.body!.result.content[0].text).toMatch(/Only the owner can move it/);
	expect((await call("get_card", { card: created.card.id })).column).toBe("inProgress");
});

test("the REST bot API reads X-Bot-Name and resolves assignees", async () => {
	const request = botRequest("POST", "/api/bot/cards", { title: "header", assignees: ["me"] });
	request.headers.set("X-Bot-Name", encodeURIComponent("受付係"));
	const response = await createCard(request);
	expect(response.status).toBe(201);
	const { card } = (await response.json()) as { card: { createdBy: { name: string }; assignees: { name: string }[] } };
	expect(card.createdBy.name).toBe("受付係");
	expect(card.assignees.map((member) => member.name)).toEqual(["受付係"]);

	const anonymous = await createCard(botRequest("POST", "/api/bot/cards", { title: "who", assignees: ["me"] }));
	expect(anonymous.status).toBe(400);
});

test("a drop parks, reorders, or runs depending on the column", async () => {
	const plain = await call("create_card", { bot: "Ops", title: "no repo" });
	const repo = await call("create_card", { bot: "Ops", title: "has repo", repo: { url: "https://github.com/a/b" } });
	const third = await call("create_card", { bot: "Ops", title: "third" });

	const parked = await command(ownerRequest(holder.current!, { type: "drop", cardId: plain.card.id, column: "todo", index: 0 }));
	const parkedBody = (await parked.json()) as { board: any; notice: string };
	expect(cardIn(parkedBody.board, plain.card.id)?.column).toBe("todo");
	expect(parkedBody.notice).toBe("Parked in Todo. Set a repo to run it.");
	expect(holder.current!.cursor.created).toEqual([]);

	const reordered = await command(ownerRequest(holder.current!, { type: "drop", cardId: third.card.id, column: "inbox", index: 0 }));
	const inbox = ((await reordered.json()) as { board: any }).board.columns.find((column: { id: string }) => column.id === "inbox");
	expect(inbox.cards.map((card: { title: string }) => card.title)).toEqual(["third", "has repo"]);

	const review = await command(ownerRequest(holder.current!, { type: "drop", cardId: third.card.id, column: "inReview", index: 0 }));
	expect(((await review.json()) as { notice: string }).notice).toBe("Cards reach In Review when an agent opens a PR.");

	const run = await command(ownerRequest(holder.current!, { type: "drop", cardId: repo.card.id, column: "todo", index: 0 }));
	const runBody = (await run.json()) as { board: any; notice: string };
	expect(cardIn(runBody.board, repo.card.id)?.column).toBe("inProgress");
	expect(holder.current!.cursor.created).toHaveLength(1);
});

test("the owner assigns from the board and manages the roster", async () => {
	const created = await call("create_card", { bot: "Ops", title: "assign me" });
	const saved = await command(
		ownerRequest(holder.current!, { type: "saveBot", id: null, profile: { name: "Talent Scout", role: "採用", avatar: "🔭", color: null } }),
	);
	const savedBoard = ((await saved.json()) as { board: any }).board;
	const scout = savedBoard.bots.find((item: { name: string }) => item.name === "Talent Scout");
	expect(scout).toMatchObject({ avatar: "🔭", role: "採用" });

	const edit = await command(ownerRequest(holder.current!, { type: "edit", cardId: created.card.id, patch: { assignees: [scout.id, "owner"] } }));
	const editBoard = ((await edit.json()) as { board: any }).board;
	expect((cardIn(editBoard, created.card.id)!.card as any).assignees.map((member: { name: string }) => member.name)).toEqual(["Talent Scout", "You"]);

	const bad = await command(ownerRequest(holder.current!, { type: "edit", cardId: created.card.id, patch: { assignees: ["nobody"] } }));
	expect(bad.status).toBe(400);

	const removed = await command(ownerRequest(holder.current!, { type: "deleteBot", id: scout.id }));
	const removedBoard = ((await removed.json()) as { board: any }).board;
	expect((cardIn(removedBoard, created.card.id)!.card as any).assignees.map((member: { name: string }) => member.name)).toEqual(["You"]);
});

test("the owner deletes a card, but not one with a live run", async () => {
	const idle = await call("create_card", { bot: "Ops", title: "throw away" });
	const removed = await command(ownerRequest(holder.current!, { type: "deleteCard", cardId: idle.card.id }));
	const removedBody = (await removed.json()) as { board: any; notice: string };
	expect(removedBody.notice).toBe("Card deleted");
	expect(cardIn(removedBody.board, idle.card.id)).toBeNull();

	const live = await call("create_card", { bot: "Ops", title: "keep", repo: { url: "https://github.com/a/b" } });
	await command(ownerRequest(holder.current!, { type: "run", cardId: live.card.id }));
	const refused = await command(ownerRequest(holder.current!, { type: "deleteCard", cardId: live.card.id }));
	expect(refused.status).toBe(400);
	expect(((await refused.json()) as { notice: string }).notice).toBe("Stop the agent before deleting this card.");
	expect((await call("get_card", { card: live.card.id })).column).toBe("inProgress");

	const tools = (await rpc("tools/list")).body!.result.tools as { name: string }[];
	expect(tools.map((tool) => tool.name).some((name) => name.includes("delete"))).toBe(false);
});

test("an uploaded icon is stored once and served from its own URL", async () => {
	const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	const saved = await command(ownerRequest(holder.current!, { type: "saveBot", id: null, profile: { name: "Pixel", role: "", avatar: png, color: null } }));
	expect(saved.status).toBe(200);
	const bot = ((await saved.json()) as any).board.bots.find((item: any) => item.name === "Pixel");
	expect(bot.avatar).toMatch(/^\/api\/avatar\/pixel\?v=/);

	// Saving again without an avatar field keeps the image.
	await command(ownerRequest(holder.current!, { type: "saveBot", id: bot.id, profile: { name: "Pixel", role: "Pixels", color: null } }));
	expect((await boardView()).bots.find((item: any) => item.id === bot.id).avatar).toBe(bot.avatar);

	const image = await avatarImage(new Request(`http://localhost:3000${bot.avatar}`, { headers: { Cookie: holder.current!.cookie } }), { params: Promise.resolve({ id: bot.id }) });
	expect(image.status).toBe(200);
	expect(image.headers.get("Content-Type")).toBe("image/png");
	expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(20);
	const anonymous = await avatarImage(new Request(`http://localhost:3000${bot.avatar}`), { params: Promise.resolve({ id: bot.id }) });
	expect(anonymous.status).toBe(401);

	const html = await command(ownerRequest(holder.current!, { type: "saveBot", id: bot.id, profile: { name: "Pixel", role: "", avatar: "data:text/html;base64,PHNjcmlwdD4=", color: null } }));
	expect(html.status).toBe(400);

	const self = await call("update_my_profile", { bot: "Selfie", avatar: png });
	expect(self.avatar).toMatch(/^http:\/\/localhost:3000\/api\/avatar\/selfie\?v=/);
	const tooBig = await rpc("tools/call", { name: "update_my_profile", arguments: { bot: "Selfie", avatar: `data:image/png;base64,${"A".repeat(130_000)}` } });
	expect(tooBig.body!.error ?? tooBig.body!.result.isError).toBeTruthy();
});

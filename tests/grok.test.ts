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

	const working = await call("move_card", { bot: "Ops", card: created.card.id, to: "inProgress", reason: "Reproducing" });
	expect(working).toMatchObject({ column: "inProgress", status: "idle", agentUrl: null });
	const checking = await call("move_card", { bot: "Ops", card: created.card.id, to: "inReview" });
	expect(checking).toMatchObject({ column: "inReview", status: "idle", prUrl: null });
	expect(checking.notes).toMatch(/Moved from Done to In Progress: Reproducing\n.*Moved from In Progress to In Review$/);
	expect(holder.current!.cursor.created).toEqual([]);

	const nowhere = await rpc("tools/call", { name: "move_card", arguments: { bot: "Ops", card: created.card.id, to: "archive" } });
	expect(nowhere.body!.error ?? nowhere.body!.result.isError).toBeTruthy();

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
	// The drop did less than it looked like it would, so the board shows it as a warning.
	expect((parkedBody as any).tone).toBe("warning");
	expect(holder.current!.cursor.created).toEqual([]);

	const reordered = await command(ownerRequest(holder.current!, { type: "drop", cardId: third.card.id, column: "inbox", index: 0 }));
	const inbox = ((await reordered.json()) as { board: any }).board.columns.find((column: { id: string }) => column.id === "inbox");
	expect(inbox.cards.map((card: { title: string }) => card.title)).toEqual(["third", "has repo"]);

	const review = await command(ownerRequest(holder.current!, { type: "drop", cardId: third.card.id, column: "inReview", index: 0 }));
	const reviewBody = (await review.json()) as { board: any; notice: string | null };
	expect(cardIn(reviewBody.board, third.card.id)).toMatchObject({ column: "inReview", card: { pill: null } });
	expect(reviewBody.notice).toBeNull();
	expect((reviewBody as any).tone).toBeNull();

	const manual = await command(ownerRequest(holder.current!, { type: "drop", cardId: plain.card.id, column: "inProgress", index: 0 }));
	const manualBody = (await manual.json()) as { board: any; notice: string };
	expect(cardIn(manualBody.board, plain.card.id)).toMatchObject({ column: "inProgress", card: { pill: null, action: { command: "run", enabled: true } } });
	expect(manualBody.notice).toBe("Moved to In Progress without an agent. Set a repo to run one.");
	expect((manualBody as any).tone).toBe("warning");
	expect(manualBody.board.agents.running).toBe(0);
	expect(holder.current!.cursor.created).toEqual([]);

	const run = await command(ownerRequest(holder.current!, { type: "drop", cardId: repo.card.id, column: "todo", index: 0 }));
	const runBody = (await run.json()) as { board: any; notice: string };
	expect(cardIn(runBody.board, repo.card.id)?.column).toBe("inProgress");
	expect((runBody as any).tone).toBeNull();
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

test("drops into In Progress and In Review respect queued and running cards", async () => {
	const live = await call("create_card", { bot: "Ops", title: "with repo", repo: { url: "https://github.com/a/b" } });
	const run = await command(ownerRequest(holder.current!, { type: "drop", cardId: live.card.id, column: "inProgress", index: 0 }));
	const runBody = (await run.json()) as { board: any };
	expect(cardIn(runBody.board, live.card.id)?.column).toBe("inProgress");
	expect(runBody.board.agents.running).toBe(1);
	expect(holder.current!.cursor.created).toHaveLength(1);

	const refused = await command(ownerRequest(holder.current!, { type: "drop", cardId: live.card.id, column: "inReview", index: 0 }));
	const refusedBody = (await refused.json()) as { board: any; notice: string };
	expect(refusedBody.notice).toBe("Stop the agent before moving this card.");
	expect((refusedBody as any).tone).toBe("warning");
	expect(cardIn(refusedBody.board, live.card.id)?.column).toBe("inProgress");

	// Fill the other two slots so the next run waits in Todo.
	for (const title of ["two", "three"]) {
		const extra = await call("create_card", { bot: "Ops", title, repo: { url: "https://github.com/a/b" } });
		await command(ownerRequest(holder.current!, { type: "run", cardId: extra.card.id }));
	}
	const waiting = await call("create_card", { bot: "Ops", title: "waits", repo: { url: "https://github.com/a/b" } });
	await command(ownerRequest(holder.current!, { type: "run", cardId: waiting.card.id }));
	expect((await call("get_card", { card: waiting.card.id })).status).toBe("queued");
	const pushed = await command(ownerRequest(holder.current!, { type: "drop", cardId: waiting.card.id, column: "inProgress", index: 0 }));
	expect(((await pushed.json()) as { notice: string }).notice).toBe("This card is already waiting for an agent slot.");
	expect((await call("get_card", { card: waiting.card.id })).status).toBe("queued");

	const bot = await rpc("tools/call", { name: "move_card", arguments: { bot: "Ops", card: waiting.card.id, to: "inProgress" } });
	expect(bot.body!.result.isError).toBe(true);
	expect(holder.current!.cursor.created).toHaveLength(3);
});

test("a command on a card that is gone says so and sends the fresh board", async () => {
	const gone = await call("create_card", { bot: "Ops", title: "short lived" });
	await command(ownerRequest(holder.current!, { type: "deleteCard", cardId: gone.card.id }));
	for (const stale of [
		{ type: "drop", cardId: gone.card.id, column: "done", index: 0 },
		{ type: "run", cardId: gone.card.id },
		{ type: "edit", cardId: gone.card.id, patch: { title: "again" } },
	]) {
		const response = await command(ownerRequest(holder.current!, stale));
		expect(response.status).toBe(404);
		const body = (await response.json()) as { board: any; notice: string };
		expect(body.notice).toBe("That card or bot no longer exists. The board was refreshed.");
		expect(cardIn(body.board, gone.card.id)).toBeNull();
	}
});

test("a run that only queues is a warning, a run that starts is not", async () => {
	const ids: string[] = [];
	for (const title of ["a", "b", "c", "d"]) ids.push((await call("create_card", { bot: "Ops", title, repo: { url: "https://github.com/a/b" } })).card.id);
	const tones: (string | null)[] = [];
	for (const id of ids) tones.push(((await (await command(ownerRequest(holder.current!, { type: "run", cardId: id }))).json()) as { tone: string | null }).tone);
	expect(tones).toEqual([null, null, null, "warning"]);
});

test("a bot without an icon is reminded to send its profile image until it does", async () => {
	const { ICON_NUDGE, MCP_INSTRUCTIONS } = await import("@/lib/mcp");
	expect(MCP_INSTRUCTIONS).toContain("update_my_profile");
	const texts = async (name: string, args: Record<string, unknown>) =>
		((await rpc("tools/call", { name, arguments: args })).body!.result.content as { text: string }[]).map((item) => item.text);

	expect(await texts("board_summary", { bot: "Faceless" })).toContain(ICON_NUDGE);
	const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	expect(await texts("update_my_profile", { bot: "Faceless", avatar: png })).not.toContain(ICON_NUDGE);
	expect(await texts("board_summary", { bot: "faceless" })).not.toContain(ICON_NUDGE);
	// The structured result stays the tool's own answer.
	const summary = await rpc("tools/call", { name: "board_summary", arguments: { bot: "Another" } });
	expect(summary.body!.result.structuredContent).not.toHaveProperty("nudge");
});

test("the owner has a default icon, can replace it, and never shows up as a bot", async () => {
	const fresh = await boardView();
	expect(fresh.owner.avatar).toBe("/api/avatar/owner?v=default");
	const defaultImage = await avatarImage(new Request("http://localhost:3000/api/avatar/owner?v=default", { headers: { Cookie: holder.current!.cookie } }), { params: Promise.resolve({ id: "owner" }) });
	expect(defaultImage.status).toBe(200);
	expect(defaultImage.headers.get("Content-Type")).toBe("image/jpeg");

	const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	const saved = await command(ownerRequest(holder.current!, { type: "setOwnerAvatar", avatar: png }));
	const savedBody = (await saved.json()) as any;
	expect(savedBody.notice).toBe("Your icon is saved");
	expect(savedBody.board.owner.avatar).toMatch(/^\/api\/avatar\/owner\?v=(?!default)/);
	expect(savedBody.board.bots.some((bot: any) => bot.id === "owner")).toBe(false);
	const uploaded = await avatarImage(new Request(`http://localhost:3000${savedBody.board.owner.avatar}`, { headers: { Cookie: holder.current!.cookie } }), { params: Promise.resolve({ id: "owner" }) });
	expect(uploaded.headers.get("Content-Type")).toBe("image/png");

	// Cards the owner holds carry the new icon, and bots never see the owner in their roster.
	const card = await call("create_card", { bot: "Ops", title: "for you", assignees: ["owner"] });
	expect(cardIn(savedBody.board, card.card.id)).toBeNull();
	const after = await boardView();
	expect((cardIn(after, card.card.id)!.card as any).assignees[0]).toMatchObject({ id: "owner", avatar: savedBody.board.owner.avatar });
	expect((await call("list_bots", {})).bots.some((bot: any) => bot.id === "owner")).toBe(false);

	// A bot named Owner gets its own id instead of taking over the owner's row.
	await call("board_summary", { bot: "Owner" });
	expect((await boardView()).bots.find((bot: any) => bot.name === "Owner")?.id).toBe("bot-owner");
	expect((await command(ownerRequest(holder.current!, { type: "deleteBot", id: "owner" }))).status).toBe(400);

	const reset = await command(ownerRequest(holder.current!, { type: "setOwnerAvatar", avatar: null }));
	expect(((await reset.json()) as any).board.owner.avatar).toBe("/api/avatar/owner?v=default");
	expect((await command(ownerRequest(holder.current!, { type: "setOwnerAvatar", avatar: "data:text/html;base64,PHNjcmlwdD4=" }))).status).toBe(400);
});

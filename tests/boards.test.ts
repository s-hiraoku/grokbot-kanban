import { beforeEach, expect, test, vi } from "vitest";
import { createGitHubOAuth } from "@/lib/github";
import { BOT_TOKEN, OWNER_PROFILE, boot, botRequest, cardIn, ownerRequest, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp; githubUser?: object } = {};

vi.mock("@/lib/runtime", () => ({
	getBoard: (user: { id: string; login: string }) => holder.current!.boardFor(user),
	getAccounts: () => holder.current!.accounts,
	getGitHub: () =>
		createGitHubOAuth({
			clientId: "client-id",
			clientSecret: holder.current!.env.githubClientSecret,
			fetch: async (input) =>
				String(input).endsWith("/access_token") ? Response.json({ access_token: "gho_test" }) : Response.json(holder.githubUser),
		}),
	env: () => holder.current!.env,
}));

const { POST: mcp } = await import("@/app/api/mcp/route");
const { POST: createCard } = await import("@/app/api/bot/cards/route");
const { POST: command } = await import("@/app/api/owner/commands/route");
const { POST: sync } = await import("@/app/api/owner/sync/route");
const { GET: listTokens, POST: makeToken } = await import("@/app/api/owner/tokens/route");
const { DELETE: revokeToken } = await import("@/app/api/owner/tokens/[id]/route");
const { GET: startSignIn } = await import("@/app/api/auth/github/route");
const { GET: callback } = await import("@/app/api/auth/github/callback/route");

const ORIGIN = "http://localhost:3000";
const ALICE = { id: 1001, login: "alice", name: "Alice", avatarUrl: null };

beforeEach(async () => {
	holder.current = await boot();
	holder.current.env = { ...holder.current.env, allowedGithubLogins: ["alice"] };
});

/** Signs a user in and returns their session cookie. */
async function signIn(profile: typeof ALICE) {
	const { token } = await holder.current!.accounts.signIn(profile, Date.now());
	return `kanban_session=${token}`;
}

const as = (cookie: string) => ({ ...holder.current!, cookie });
const view = async (cookie: string) => (await sync(syncRequest(as(cookie)))).json() as Promise<any>;
const titles = (board: any) => board.columns.flatMap((column: any) => column.cards.map((card: any) => card.title));

let nextId = 1;
async function tool(token: string | null, name: string, args: Record<string, unknown>) {
	const response = await mcp(botRequest("POST", "/api/mcp", { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }, token));
	if (response.status !== 200) return { status: response.status, result: null };
	const body = (await response.json()) as any;
	if (body.result.isError) throw new Error(body.result.content[0].text);
	return { status: 200, result: body.result.structuredContent };
}

async function newToken(cookie: string, label?: string) {
	const response = await makeToken(new Request(`${ORIGIN}/api/owner/tokens`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ label }) }));
	return { status: response.status, body: (await response.json()) as any };
}

test("each user sees only their own board, from the browser and from their Bots", async () => {
	const owner = holder.current!.cookie;
	const alice = await signIn(ALICE);
	await command(ownerRequest(as(owner), { type: "create", content: { title: "Owner's card" } }));
	await command(ownerRequest(as(alice), { type: "create", content: { title: "Alice's card" } }));

	expect(titles(await view(owner))).toEqual(["Owner's card"]);
	expect(titles(await view(alice))).toEqual(["Alice's card"]);

	const aliceToken = (await newToken(alice)).body.token as string;
	// The same Bot name and the same external id live on both boards without meeting.
	const filed = await tool(aliceToken, "create_card", { bot: "Scout", title: "Filed by Alice's Scout", externalId: "x-1" });
	const ownerFiled = await tool(BOT_TOKEN, "create_card", { bot: "Scout", title: "Filed by the owner's Scout", externalId: "x-1" });
	expect(filed.result.card.id).not.toBe(ownerFiled.result.card.id);

	expect(titles(await view(alice))).toEqual(["Alice's card", "Filed by Alice's Scout"]);
	expect(titles(await view(owner))).toEqual(["Owner's card", "Filed by the owner's Scout"]);
	expect((await tool(aliceToken, "list_cards", { bot: "Scout" })).result.cards.map((card: any) => card.title)).toEqual(["Alice's card", "Filed by Alice's Scout"]);
	expect((await view(alice)).bots.map((bot: any) => bot.name)).toEqual(["Scout"]);

	// A card id from another board is not found, so a Bot cannot read or move someone else's card.
	const ownerCard = cardIn(await view(owner), ownerFiled.result.card.id)!;
	await expect(tool(aliceToken, "get_card", { card: ownerCard.card.id })).rejects.toThrow(/not found|No card/i);
	await expect(tool(aliceToken, "move_card", { bot: "Scout", card: ownerCard.card.id, to: "done", reason: "x" })).rejects.toThrow(/not found|No card/i);
	const moved = await command(ownerRequest(as(alice), { type: "deleteCard", cardId: ownerCard.card.id }));
	expect(moved.status).toBe(404);
	expect(titles(await view(owner))).toContain("Filed by the owner's Scout");
});

test("a connector token is shown once, stored as a hash, records its last use, and stops working when revoked", async () => {
	const owner = holder.current!.cookie;
	const made = await newToken(owner, "  Kanban   Bot ");
	expect(made.status).toBe(201);
	expect(made.body.token).toMatch(/^gbk_[\w-]{43}$/);
	expect(made.body.info).toMatchObject({ label: "Kanban Bot", lastUsedAt: null });
	const stored = await holder.current!.client.query<{ token_hash: string }>("select token_hash from bot_tokens");
	expect(stored.rows.map((row) => row.token_hash)).not.toContain(made.body.token);

	// Listing needs no Origin, since browsers leave it off same-origin GETs, and never returns the token.
	const listed = await listTokens(new Request(`${ORIGIN}/api/owner/tokens`, { headers: { Cookie: owner } }));
	const list = (await listed.json()) as any;
	expect(list.tokens).toEqual([made.body.info]);
	expect(JSON.stringify(list)).not.toContain(made.body.token);

	expect((await tool(made.body.token, "board_summary", { bot: "Kanban" })).status).toBe(200);
	const used = (await (await listTokens(new Request(`${ORIGIN}/api/owner/tokens`, { headers: { Cookie: owner } }))).json()) as any;
	expect(used.tokens[0].lastUsedAt).toEqual(expect.any(Number));

	const revoked = await revokeToken(new Request(`${ORIGIN}/api/owner/tokens/${made.body.info.id}`, { method: "DELETE", headers: { Origin: ORIGIN, Cookie: owner } }), { params: Promise.resolve({ id: made.body.info.id }) });
	expect(revoked.status).toBe(200);
	expect(((await revoked.json()) as any).tokens).toEqual([]);
	expect((await tool(made.body.token, "board_summary", { bot: "Kanban" })).status).toBe(401);
	expect((await createCard(botRequest("POST", "/api/bot/cards", { title: "x" }, made.body.token))).status).toBe(401);
});

test("tokens are managed only by their own user and only from the board's own pages", async () => {
	const owner = holder.current!.cookie;
	const alice = await signIn(ALICE);
	const ownerToken = (await newToken(owner)).body.info;

	const theirs = await revokeToken(new Request(`${ORIGIN}/api/owner/tokens/${ownerToken.id}`, { method: "DELETE", headers: { Origin: ORIGIN, Cookie: alice } }), { params: Promise.resolve({ id: ownerToken.id }) });
	expect(theirs.status).toBe(404);
	const crossSite = await makeToken(new Request(`${ORIGIN}/api/owner/tokens`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: owner }, body: "{}" }));
	expect(crossSite.status).toBe(403);
	expect((await listTokens(new Request(`${ORIGIN}/api/owner/tokens`))).status).toBe(401);
	expect((await newToken(owner, "x".repeat(41))).status).toBe(400);
	const aliceList = (await (await listTokens(new Request(`${ORIGIN}/api/owner/tokens`, { headers: { Cookie: alice } }))).json()) as any;
	expect(aliceList.tokens).toEqual([]);
});

test("the old shared BOT_TOKEN opens the owner's board until it is removed, and a made-up token opens nothing", async () => {
	expect((await tool(BOT_TOKEN, "board_summary", { bot: "Scout" })).status).toBe(200);
	expect((await tool("gbk_made-up", "board_summary", { bot: "Scout" })).status).toBe(401);
	expect((await tool("wrong", "board_summary", { bot: "Scout" })).status).toBe(401);
	holder.current!.env = { ...holder.current!.env, botToken: null };
	expect((await tool(BOT_TOKEN, "board_summary", { bot: "Scout" })).status).toBe(401);
});

test("only accounts let in by ALLOWED_GITHUB_LOGINS can sign in, and taking one out shuts its sessions and tokens", async () => {
	const alice = await signIn(ALICE);
	const aliceToken = (await newToken(alice)).body.token as string;
	expect((await sync(syncRequest(as(alice)))).status).toBe(200);

	holder.current!.env = { ...holder.current!.env, allowedGithubLogins: [] };
	expect((await sync(syncRequest(as(alice)))).status).toBe(401);
	expect((await tool(aliceToken, "board_summary", { bot: "Scout" })).status).toBe(401);
	expect((await sync(syncRequest(holder.current!))).status).toBe(200);

	holder.githubUser = { id: 2002, login: "bob", name: null, avatar_url: null };
	expect((await signInThroughGitHub()).headers.get("location")).toBe(`${ORIGIN}/login?error=not_allowed`);
	holder.current!.env = { ...holder.current!.env, allowedGithubLogins: "*" };
	expect((await signInThroughGitHub()).headers.get("location")).toBe(`${ORIGIN}/`);
});

test("cards and Bots from before accounts go to the owner at sign-in, never to another user", async () => {
	const { client } = holder.current!;
	await client.query("insert into cards (id, created_at, title, body, notes, priority, kind, assignees, rank, state, state_version) values (gen_random_uuid(), now(), 'From before', '', '', 'normal', '{\"type\":\"text\"}', '[]', '1', '{\"kind\":\"idle\",\"column\":\"todo\"}', 0)");
	await client.query("insert into bots (id, name, role, color, created_at) values ('scout', 'Scout', '', '#7aa2ff', now())");

	holder.githubUser = { id: ALICE.id, login: ALICE.login, name: null, avatar_url: null };
	const aliceIn = await signInThroughGitHub();
	const alice = aliceIn.headers.getSetCookie().find((item) => item.startsWith("kanban_session="))!.split(";")[0]!;
	expect(titles(await view(alice))).toEqual([]);

	holder.githubUser = { id: OWNER_PROFILE.id, login: OWNER_PROFILE.login, name: null, avatar_url: null };
	const ownerIn = await signInThroughGitHub();
	const owner = ownerIn.headers.getSetCookie().find((item) => item.startsWith("kanban_session="))!.split(";")[0]!;
	const board = await view(owner);
	expect(titles(board)).toEqual(["From before"]);
	expect(board.bots.map((bot: any) => bot.name)).toEqual(["Scout"]);
	const left = await client.query("select id::text from cards where user_id is null union all select id from bots where user_id is null");
	expect(left.rows).toEqual([]);
});

test("Cursor stays off on every board but the owner's, since CURSOR_API_KEY is the owner's account", async () => {
	holder.current = await boot({ cursor: { createAgent: async () => ({ kind: "rejected", message: "unused" }), checkRun: async () => ({ phase: "running" }), cancel: async () => true } as never });
	holder.current.env = { ...holder.current.env, allowedGithubLogins: ["alice"] };
	const alice = await signIn(ALICE);
	expect((await view(holder.current.cookie)).cursor).toEqual({ enabled: true });
	expect((await view(alice)).cursor).toEqual({ enabled: false });
	const aliceToken = (await newToken(alice)).body.token as string;
	const card = await tool(aliceToken, "create_card", { bot: "Scout", title: "Needs code", repo: { url: "https://github.com/a/b", startingRef: "main" } });
	await expect(tool(aliceToken, "hand_off_to_cursor", { bot: "Scout", card: card.result.card.id })).rejects.toThrow(/owner's board/);
});

async function signInThroughGitHub() {
	const started = await startSignIn(new Request(`${ORIGIN}/api/auth/github`));
	const state = new URL(started.headers.get("location")!).searchParams.get("state");
	const jar = started.headers.get("set-cookie")!.split(";")[0]!;
	return callback(new Request(`${ORIGIN}/api/auth/github/callback?code=c&state=${state}`, { headers: { Cookie: jar } }));
}

import { beforeEach, expect, test, vi } from "vitest";
import { createGitHubOAuth } from "@/lib/github";
import { OWNER_PROFILE, boot, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp; githubUser?: object; codes: string[] } = { codes: [] };

// GitHub, played by a fetch that accepts the codes in holder.codes and answers /user with holder.githubUser.
const fakeGitHub: typeof fetch = async (input, init) => {
	const url = String(input);
	if (url === "https://github.com/login/oauth/access_token") {
		const body = JSON.parse(String(init?.body)) as { code: string; code_verifier: string; client_secret: string };
		const ok = holder.codes.includes(body.code) && body.code_verifier.length >= 43 && body.client_secret === holder.current!.env.githubClientSecret;
		return Response.json(ok ? { access_token: `gho_${body.code}` } : { error: "bad_verification_code" });
	}
	if (url === "https://api.github.com/user") return Response.json(holder.githubUser);
	return new Response(null, { status: 404 });
};

vi.mock("@/lib/runtime", () => ({
	getBoard: () => holder.current!.board,
	getAccounts: () => holder.current!.accounts,
	getGitHub: () => createGitHubOAuth({ clientId: "client-id", clientSecret: holder.current!.env.githubClientSecret, fetch: fakeGitHub }),
	env: () => holder.current!.env,
}));

const { GET: start } = await import("@/app/api/auth/github/route");
const { GET: callback } = await import("@/app/api/auth/github/callback/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: sync } = await import("@/app/api/owner/sync/route");

const ORIGIN = "http://localhost:3000";
const githubUser = (profile = OWNER_PROFILE) => ({ id: profile.id, login: profile.login, name: profile.name, avatar_url: "https://avatars.githubusercontent.com/u/1" });

beforeEach(async () => {
	holder.current = await boot();
	holder.githubUser = githubUser();
	holder.codes = ["good-code"];
});

/** Starts sign-in and returns what GitHub would see and the cookie the browser keeps. */
async function begin() {
	const response = await start(new Request(`${ORIGIN}/api/auth/github`));
	const location = new URL(response.headers.get("location")!);
	const cookie = response.headers.get("set-cookie")!;
	return { response, location, cookie, state: location.searchParams.get("state")!, jar: cookie.split(";")[0]! };
}

function back(query: string, jar?: string) {
	return callback(new Request(`${ORIGIN}/api/auth/github/callback?${query}`, { headers: jar ? { Cookie: jar } : {} }));
}

const sessionFrom = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((item) => item.startsWith("kanban_session="))
		?.split(";")[0];

test("sign-in sends the browser to GitHub with a fresh state and a PKCE challenge", async () => {
	const { response, location, cookie } = await begin();
	expect(response.status).toBe(302);
	expect(`${location.origin}${location.pathname}`).toBe("https://github.com/login/oauth/authorize");
	expect(location.searchParams.get("client_id")).toBe("client-id");
	expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/github/callback`);
	expect(location.searchParams.get("code_challenge_method")).toBe("S256");
	expect(location.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
	expect(cookie).toMatch(/^kanban_sign_in=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600$/);
	// The verifier stays in the cookie; GitHub only sees its hash.
	expect(location.toString()).not.toContain(cookie.split(".")[1]!.split(";")[0]);
	const second = await begin();
	expect(second.state).not.toBe(location.searchParams.get("state"));
});

test("the owner's GitHub account gets a session that opens the board, and only its hash is stored", async () => {
	const { state, jar } = await begin();
	const response = await back(`code=good-code&state=${state}`, jar);
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
	const cookies = response.headers.getSetCookie();
	expect(cookies).toContainEqual(expect.stringMatching(/^kanban_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/));
	expect(cookies).toContainEqual(expect.stringMatching(/^kanban_sign_in=; .*Max-Age=0/));

	const session = sessionFrom(response)!;
	const opened = await sync(new Request(`${ORIGIN}/api/owner/sync`, { method: "POST", headers: { Origin: ORIGIN, Cookie: session } }));
	expect(opened.status).toBe(200);

	const token = session.split("=")[1]!;
	const rows = await holder.current!.client.query<{ token_hash: string }>("select token_hash from sessions");
	expect(rows.rows.length).toBe(2);
	expect(rows.rows.map((row) => row.token_hash)).not.toContain(token);
	const users = await holder.current!.client.query<{ login: string; avatar_url: string }>("select login, avatar_url from users");
	expect(users.rows).toEqual([{ login: "s-hiraoku", avatar_url: "https://avatars.githubusercontent.com/u/1" }]);
});

test("a callback without the state this browser was given starts no session", async () => {
	const { state, jar } = await begin();
	for (const [query, cookie] of [
		[`code=good-code&state=${state}`, undefined],
		[`code=good-code&state=someone-elses-state`, jar],
		[`code=good-code`, jar],
	] as const) {
		const response = await back(query, cookie);
		expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=state`);
		expect(sessionFrom(response)).toBeUndefined();
	}
});

test("another GitHub account is turned away without being recorded", async () => {
	holder.githubUser = githubUser({ id: 1, login: "someone-else", name: null, avatarUrl: null });
	const { state, jar } = await begin();
	const response = await back(`code=good-code&state=${state}`, jar);
	expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=not_allowed`);
	expect(sessionFrom(response)).toBeUndefined();
	const users = await holder.current!.client.query("select * from users where login = 'someone-else'");
	expect(users.rows).toEqual([]);
});

test("a code GitHub refuses, or a cancelled sign-in, says so and starts no session", async () => {
	const first = await begin();
	const refused = await back(`code=stolen-code&state=${first.state}`, first.jar);
	expect(refused.headers.get("location")).toBe(`${ORIGIN}/login?error=github`);
	expect(sessionFrom(refused)).toBeUndefined();

	const second = await begin();
	const cancelled = await back(`error=access_denied&state=${second.state}`, second.jar);
	expect(cancelled.headers.get("location")).toBe(`${ORIGIN}/login?error=denied`);
});

test("signing out ends the session on the server, so a copied cookie stops working", async () => {
	const app = holder.current!;
	expect((await sync(syncRequest(app))).status).toBe(200);
	const response = await logout(new Request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { Origin: ORIGIN, Cookie: app.cookie } }));
	expect(response.status).toBe(303);
	expect(response.headers.get("set-cookie")).toMatch(/^kanban_session=; .*Max-Age=0/);
	expect((await sync(syncRequest(app))).status).toBe(401);
});

test("sign-out from another site is refused and keeps the session", async () => {
	const app = holder.current!;
	const response = await logout(new Request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: app.cookie } }));
	expect(response.status).toBe(403);
	expect((await sync(syncRequest(app))).status).toBe(200);
});

test("a session expires after 30 days, and a made-up or missing cookie opens nothing", async () => {
	const app = holder.current!;
	const token = app.cookie.split("=")[1]!;
	expect(await app.accounts.userFor(token, Date.now() + 29 * 86_400_000)).toMatchObject({ login: "s-hiraoku" });
	expect(await app.accounts.userFor(token, Date.now() + 31 * 86_400_000)).toBeNull();
	expect(await app.accounts.userFor("made-up", Date.now())).toBeNull();
	expect(await app.accounts.userFor(undefined, Date.now())).toBeNull();
	const forged = await sync(new Request(`${ORIGIN}/api/owner/sync`, { method: "POST", headers: { Origin: ORIGIN, Cookie: "kanban_session=made-up" } }));
	expect(forged.status).toBe(401);
});

test("changing OWNER_GITHUB_LOGIN shuts out sessions of the previous owner", async () => {
	const app = holder.current!;
	app.env = { ...app.env, ownerGithubLogin: "new-owner" };
	expect((await sync(syncRequest(app))).status).toBe(401);
});

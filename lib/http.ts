import { BOT_TOKEN_PREFIX, type User } from "./accounts";
import { bearerMatches, mintBot, mintOwner, tokenFromCookie, type Bot, type Owner } from "./auth";
import { BadRequest } from "./parse";
import { mayUseBoard } from "./access";
import { getAccounts, type Env } from "./runtime";

type RouteContext = { params: Promise<Record<string, string>> };

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
	return Response.json(body, { status, headers });
}

export function badRequest(message?: string): Response {
	return json(message ? { error: "bad_request", message } : { error: "bad_request" }, 400);
}

/** The calling Grok Bot's name, from the optional X-Bot-Name header. */
export function botNameFrom(req: Request): string | null {
	const raw = req.headers.get("x-bot-name");
	if (!raw) return null;
	try {
		return decodeURIComponent(raw).trim() || null;
	} catch {
		return raw.trim() || null;
	}
}

export function unauthorized(): Response {
	return json({ error: "unauthorized" }, 401);
}

export function forbidden(): Response {
	return json({ error: "forbidden" }, 403);
}

export function notFound(): Response {
	return json({ error: "not_found" }, 404);
}

export async function readJson(req: Request): Promise<unknown> {
	const text = await req.text();
	if (!text) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new BadRequest();
	}
}

export function sameOrigin(req: Request): boolean {
	const origin = req.headers.get("origin");
	if (!origin) return false;
	return origin === new URL(req.url).origin;
}

export function requestIsSecure(req: Request): boolean {
	const forwarded = req.headers.get("x-forwarded-proto");
	if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
	return new URL(req.url).protocol === "https:";
}

/** The signed-in user, from the session cookie. */
export async function userFromRequest(req: Request, now = Date.now()): Promise<User | null> {
	return getAccounts().userFor(tokenFromCookie(req.headers.get("cookie")), now);
}

/** Whether the signed-in user may use their board: the owner, and whoever ALLOWED_GITHUB_LOGINS lets in. */
export function canUseBoard(user: User | null, env: Env): user is User {
	return user !== null && mayUseBoard(user.login, env);
}

/** A capability with the user whose board it opens. */
export type Signed<C> = { cap: C; user: User };

export async function ownerFromRequest(req: Request, env: Env, now = Date.now()): Promise<Signed<Owner> | null> {
	const user = await userFromRequest(req, now);
	return canUseBoard(user, env) ? { cap: mintOwner(), user } : null;
}

export async function requireOwner(req: Request, env: Env): Promise<Signed<Owner> | Response> {
	if (!sameOrigin(req)) return forbidden();
	const owner = await ownerFromRequest(req, env);
	if (!owner) return unauthorized();
	return owner;
}

/**
 * A Bot call opens the board of the user whose token it carries. The old shared BOT_TOKEN, while it is set,
 * opens the owner's board.
 */
export async function requireBot(req: Request, env: Env, now = Date.now()): Promise<Signed<Bot> | Response> {
	const header = req.headers.get("authorization");
	const token = /^Bearer (.+)$/.exec(header ?? "")?.[1];
	if (!token) return unauthorized();
	const accounts = getAccounts();
	let user: User | null = null;
	if (token.startsWith(BOT_TOKEN_PREFIX)) user = await accounts.userForBotToken(token, now);
	else if (env.botToken && bearerMatches(header, env.botToken)) user = await accounts.userByLogin(env.ownerGithubLogin);
	if (!canUseBoard(user, env)) return unauthorized();
	return { cap: mintBot(), user };
}

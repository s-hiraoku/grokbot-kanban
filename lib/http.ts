import { bearerMatches, clearedSessionCookie, mintBot, mintCron, mintOwner, readSession, sessionCookie, tokenFromCookie, type Bot, type Cron, type Owner } from "./auth";
import { BadRequest } from "./parse";
import type { Env } from "./runtime";

type RouteContext = { params: Promise<Record<string, string>> };

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
	return Response.json(body, { status, headers });
}

export function badRequest(): Response {
	return json({ error: "bad_request" }, 400);
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

export function ownerFromRequest(req: Request, env: Env, now = Date.now()): Owner | null {
	const token = tokenFromCookie(req.headers.get("cookie"));
	if (!readSession(token, env.ownerPassword, now)) return null;
	return mintOwner();
}

export function requireOwner(req: Request, env: Env): Owner | Response {
	if (!sameOrigin(req)) return forbidden();
	const owner = ownerFromRequest(req, env);
	if (!owner) return unauthorized();
	return owner;
}

export function requireBot(req: Request, env: Env): Bot | Response {
	if (!bearerMatches(req.headers.get("authorization"), env.botToken)) return unauthorized();
	return mintBot();
}

export function requireCron(req: Request, env: Env): Cron | Response {
	if (!bearerMatches(req.headers.get("authorization"), env.cronSecret)) return unauthorized();
	return mintCron();
}

export function loginCookie(env: Env, req: Request): string {
	return sessionCookie(env.ownerPassword, Date.now(), requestIsSecure(req));
}

export function logoutCookie(req: Request): string {
	return clearedSessionCookie(requestIsSecure(req));
}

export type { RouteContext };

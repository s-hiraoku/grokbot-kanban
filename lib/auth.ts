import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// Symbol.for keeps capabilities equal when Next loads this module once per route bundle.
const capability: unique symbol = Symbol.for("grokbot-kanban.capability") as never;
const OWNER = Symbol.for("grokbot-kanban.owner");
const BOT = Symbol.for("grokbot-kanban.bot");
const CRON = Symbol.for("grokbot-kanban.cron");

export type Owner = { readonly [capability]: typeof OWNER };
export type Bot = { readonly [capability]: typeof BOT };
export type Cron = { readonly [capability]: typeof CRON };

export function mintOwner(): Owner {
	return { [capability]: OWNER };
}
export function mintBot(): Bot {
	return { [capability]: BOT };
}
export function mintCron(): Cron {
	return { [capability]: CRON };
}

export function isOwner(value: Owner): boolean {
	return value[capability] === OWNER;
}
export function isBot(value: Bot): boolean {
	return value[capability] === BOT;
}
export function isCron(value: Cron): boolean {
	return value[capability] === CRON;
}

export const SESSION_COOKIE = "kanban_owner";
const MAX_AGE = 30 * 24 * 60 * 60;

export function checkPassword(candidate: string, expected: string): boolean {
	return safeEqual(candidate, expected);
}

export function bearerMatches(header: string | null, expected: string): boolean {
	if (!header) return false;
	const match = /^Bearer (.+)$/.exec(header);
	if (!match?.[1]) return false;
	return safeEqual(match[1], expected);
}

export function sessionCookie(password: string, nowMs: number, secure: boolean): string {
	const expiresAt = Math.floor(nowMs / 1000) + MAX_AGE;
	const mac = sign(password, expiresAt);
	const secureFlag = secure ? "; Secure" : "";
	return `${SESSION_COOKIE}=v1.${expiresAt}.${mac}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secureFlag}`;
}

export function clearedSessionCookie(secure: boolean): string {
	const secureFlag = secure ? "; Secure" : "";
	return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

export function readSession(token: string | undefined, password: string, nowMs: number): boolean {
	if (!token) return false;
	const parts = token.split(".");
	if (parts.length !== 3 || parts[0] !== "v1") return false;
	const expiresAt = Number(parts[1]);
	if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= nowMs) return false;
	const expected = sign(password, expiresAt);
	if (expected.length !== parts[2].length) return false;
	return timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]));
}

export function tokenFromCookie(header: string | null): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === SESSION_COOKIE) return rest.join("=");
	}
	return undefined;
}

function sign(password: string, expiresAt: number): string {
	return createHmac("sha256", password).update(`v1.${expiresAt}`).digest("base64url");
}

function safeEqual(candidate: string, expected: string): boolean {
	const left = createHash("sha256").update(candidate).digest();
	const right = createHash("sha256").update(expected).digest();
	return timingSafeEqual(left, right);
}

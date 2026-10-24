import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { SESSION_DAYS, hashToken, randomToken } from "./auth";
import * as schema from "./schema";

const { botTokens, bots, cards, sessions, users } = schema;

/** Prefix of tokens made on the board, so a leaked one is easy to recognize. */
export const BOT_TOKEN_PREFIX = "gbk_";
/** Last use is recorded at most this often, so each Bot call does not write to the database. */
const LAST_USED_EVERY_MS = 5 * 60 * 1000;

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Who GitHub says signed in. */
export type GitHubProfile = { id: number; login: string; name: string | null; avatarUrl: string | null };

export type User = { id: string; githubId: number; login: string; name: string | null; avatarUrl: string | null };

/** A connector token as the board lists it. The token itself is shown once, when it is made. */
export type BotTokenInfo = { id: string; label: string; createdAt: number; lastUsedAt: number | null };

export type Accounts = {
	/** Records the sign-in and opens a session. The token goes in the cookie; only its hash is stored. */
	signIn(profile: GitHubProfile, nowMs: number): Promise<{ user: User; token: string }>;
	/** The user a session cookie belongs to, or null when it is unknown, expired, or signed out. */
	userFor(token: string | undefined, nowMs: number): Promise<User | null>;
	signOut(token: string | undefined): Promise<void>;
	userByLogin(login: string): Promise<User | null>;
	/** Gives the user every card and Bot that belongs to no board yet: the board from before accounts. */
	claimUnowned(userId: string): Promise<void>;
	createBotToken(userId: string, label: string, nowMs: number): Promise<{ token: string; info: BotTokenInfo }>;
	botTokens(userId: string): Promise<BotTokenInfo[]>;
	/** Deletes the token; a connector still using it is refused from the next call. */
	revokeBotToken(userId: string, id: string): Promise<boolean>;
	/** The user a connector token belongs to, or null when it is unknown or was revoked. */
	userForBotToken(token: string, nowMs: number): Promise<User | null>;
};

export function createAccounts(db: Db): Accounts {
	return {
		async signIn(profile, nowMs) {
			const now = new Date(nowMs);
			const [row] = await db
				.insert(users)
				.values({ id: randomUUID(), githubId: profile.id, login: profile.login, name: profile.name, avatarUrl: profile.avatarUrl, createdAt: now, lastSignInAt: now })
				.onConflictDoUpdate({ target: users.githubId, set: { login: profile.login, name: profile.name, avatarUrl: profile.avatarUrl, lastSignInAt: now } })
				.returning();
			if (!row) throw new Error("sign-in did not return the user");
			// Expired sessions are only ever read to be refused, so each sign-in clears the user's old ones.
			await db.delete(sessions).where(and(eq(sessions.userId, row.id), lt(sessions.expiresAt, now)));
			const token = randomToken();
			await db.insert(sessions).values({ tokenHash: hashToken(token), userId: row.id, createdAt: now, expiresAt: new Date(nowMs + SESSION_DAYS * 24 * 60 * 60 * 1000) });
			return { user: toUser(row), token };
		},

		async userFor(token, nowMs) {
			if (!token) return null;
			const [row] = await db
				.select({ user: users, expiresAt: sessions.expiresAt })
				.from(sessions)
				.innerJoin(users, eq(users.id, sessions.userId))
				.where(eq(sessions.tokenHash, hashToken(token)));
			if (!row || row.expiresAt.getTime() <= nowMs) return null;
			return toUser(row.user);
		},

		async signOut(token) {
			if (!token) return;
			await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
		},

		async userByLogin(login) {
			const [row] = await db.select().from(users).where(eq(sql`lower(${users.login})`, login.toLowerCase()));
			return row ? toUser(row) : null;
		},

		async claimUnowned(userId) {
			await db.update(cards).set({ userId }).where(isNull(cards.userId));
			await db.update(bots).set({ userId }).where(isNull(bots.userId));
		},

		async createBotToken(userId, label, nowMs) {
			const token = `${BOT_TOKEN_PREFIX}${randomToken()}`;
			const [row] = await db
				.insert(botTokens)
				.values({ id: randomUUID(), userId, label, tokenHash: hashToken(token), createdAt: new Date(nowMs), lastUsedAt: null })
				.returning();
			if (!row) throw new Error("token insert returned no row");
			return { token, info: toTokenInfo(row) };
		},

		async botTokens(userId) {
			const rows = await db.select().from(botTokens).where(eq(botTokens.userId, userId));
			return rows.map(toTokenInfo).sort((a, b) => a.createdAt - b.createdAt);
		},

		async revokeBotToken(userId, id) {
			if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
			const rows = await db.delete(botTokens).where(and(eq(botTokens.userId, userId), eq(botTokens.id, id))).returning();
			return rows.length > 0;
		},

		async userForBotToken(token, nowMs) {
			if (!token.startsWith(BOT_TOKEN_PREFIX)) return null;
			const tokenHash = hashToken(token);
			const [row] = await db.select({ user: users, lastUsedAt: botTokens.lastUsedAt }).from(botTokens).innerJoin(users, eq(users.id, botTokens.userId)).where(eq(botTokens.tokenHash, tokenHash));
			if (!row) return null;
			if (!row.lastUsedAt || nowMs - row.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
				const stale = new Date(nowMs - LAST_USED_EVERY_MS);
				await db
					.update(botTokens)
					.set({ lastUsedAt: new Date(nowMs) })
					.where(and(eq(botTokens.tokenHash, tokenHash), or(isNull(botTokens.lastUsedAt), lt(botTokens.lastUsedAt, stale))));
			}
			return toUser(row.user);
		},
	};
}

function toUser(row: typeof users.$inferSelect): User {
	return { id: row.id, githubId: row.githubId, login: row.login, name: row.name, avatarUrl: row.avatarUrl };
}

function toTokenInfo(row: typeof botTokens.$inferSelect): BotTokenInfo {
	return { id: row.id, label: row.label, createdAt: row.createdAt.getTime(), lastUsedAt: row.lastUsedAt?.getTime() ?? null };
}

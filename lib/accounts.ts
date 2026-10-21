import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { SESSION_DAYS, hashToken, randomToken } from "./auth";
import * as schema from "./schema";

const { sessions, users } = schema;

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Who GitHub says signed in. */
export type GitHubProfile = { id: number; login: string; name: string | null; avatarUrl: string | null };

export type User = { id: string; githubId: number; login: string; name: string | null; avatarUrl: string | null };

export type Accounts = {
	/** Records the sign-in and opens a session. The token goes in the cookie; only its hash is stored. */
	signIn(profile: GitHubProfile, nowMs: number): Promise<{ user: User; token: string }>;
	/** The user a session cookie belongs to, or null when it is unknown, expired, or signed out. */
	userFor(token: string | undefined, nowMs: number): Promise<User | null>;
	signOut(token: string | undefined): Promise<void>;
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
	};
}

function toUser(row: typeof users.$inferSelect): User {
	return { id: row.id, githubId: row.githubId, login: row.login, name: row.name, avatarUrl: row.avatarUrl };
}

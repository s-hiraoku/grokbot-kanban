import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { openBoard, type BoardHandle, type OwnerCommand } from "@/lib/board";
import type { CursorClient } from "@/lib/cursor";
import type { Instant } from "@/lib/domain";
import { createAccounts, type Accounts, type Db, type GitHubProfile } from "@/lib/accounts";
import * as schema from "@/lib/schema";
import { migrationSql } from "@/lib/migrations";
import { createStore } from "@/lib/store";
import type { Env } from "@/lib/runtime";

export const OWNER_LOGIN = "s-hiraoku";
export const OWNER_PROFILE: GitHubProfile = { id: 18750282, login: OWNER_LOGIN, name: "Hiraoku", avatarUrl: null };
export const BOT_TOKEN = "b".repeat(32);

export type TestApp = {
	board: BoardHandle;
	accounts: Accounts;
	env: Env;
	client: PGlite;
	setNow: (value: number) => void;
	now: () => number;
	cookie: string;
};

export async function boot(options: { cursor?: CursorClient } = {}): Promise<TestApp> {
	const client = new PGlite();
	await client.exec(migrationSql());
	const db = drizzle(client, { schema });
	let now = Date.parse("2026-10-11T00:00:00.000Z");
	const board = openBoard({
		store: createStore(db as never),
		now: () => now as Instant,
		cursor: options.cursor ?? null,
	});
	const accounts = createAccounts(db as never as Db);
	const env: Env = {
		databaseUrl: "postgres://test",
		githubClientId: "client-id",
		githubClientSecret: "s".repeat(40),
		ownerGithubLogin: OWNER_LOGIN,
		githubWebUrl: null,
		githubApiUrl: null,
		botToken: BOT_TOKEN,
		studioUrl: null,
		cursorApiKey: options.cursor ? "c".repeat(32) : null,
		cursorApiUrl: null,
	};
	const { token } = await accounts.signIn(OWNER_PROFILE, Date.now());
	return {
		board,
		accounts,
		env,
		client,
		setNow: (value) => {
			now = value;
		},
		now: () => now,
		cookie: `kanban_session=${token}`,
	};
}

export function ownerRequest(app: TestApp, body: object): Request {
	return new Request("http://localhost:3000/api/owner/commands", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:3000",
			Cookie: app.cookie,
		},
		body: JSON.stringify(body),
	});
}

export function syncRequest(app: TestApp): Request {
	return new Request("http://localhost:3000/api/owner/sync", {
		method: "POST",
		headers: { Origin: "http://localhost:3000", Cookie: app.cookie },
	});
}

export function botRequest(method: string, path: string, body?: unknown, token: string | null = BOT_TOKEN): Request {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (token) headers.set("Authorization", `Bearer ${token}`);
	return new Request(`http://localhost:3000${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

export function cardIn(board: { columns: { id: string; cards: { id: string }[] }[] }, id: string) {
	for (const column of board.columns) {
		const card = column.cards.find((item) => item.id === id);
		if (card) return { column: column.id, card };
	}
	return null;
}

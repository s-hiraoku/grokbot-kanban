import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { openBoard, type BoardHandle } from "./board";
import { createCursorClient } from "./cursor";
import { migrationSql } from "./migrations";
import { createStore } from "./store";
import * as schema from "./schema";

export type Env = {
	databaseUrl: string;
	cursorApiKey: string;
	ownerPassword: string;
	botToken: string;
	cronSecret: string;
	studioUrl: string | null;
};

const MIN_SECRET = 32;

export function env(source: NodeJS.ProcessEnv = process.env): Env {
	const databaseUrl = required(source, "DATABASE_URL");
	const cursorApiKey = required(source, "CURSOR_API_KEY");
	const ownerPassword = required(source, "OWNER_PASSWORD");
	const botToken = required(source, "BOT_TOKEN");
	const cronSecret = required(source, "CRON_SECRET");
	const problems: string[] = [];
	if (ownerPassword.length < MIN_SECRET) problems.push("OWNER_PASSWORD must be at least 32 characters");
	if (botToken.length < MIN_SECRET) problems.push("BOT_TOKEN must be at least 32 characters");
	if (cronSecret.length < MIN_SECRET) problems.push("CRON_SECRET must be at least 32 characters");
	const secrets = [ownerPassword, botToken, cronSecret, cursorApiKey];
	if (new Set(secrets).size !== secrets.length) problems.push("OWNER_PASSWORD, BOT_TOKEN, CRON_SECRET, and CURSOR_API_KEY must differ");
	const studio = source.STUDIO_URL?.trim() || null;
	if (studio && !studio.startsWith("https://")) problems.push("STUDIO_URL must start with https://");
	if (problems.length) throw new Error(problems.join("; "));
	return { databaseUrl, cursorApiKey, ownerPassword, botToken, cronSecret, studioUrl: studio };
}

function required(source: NodeJS.ProcessEnv, name: string): string {
	const value = source[name]?.trim() ?? "";
	if (!value) throw new Error(`${name} is required`);
	return value;
}

// Next bundles each route separately, so a module-level cache would give every route its own local PGlite.
const cache = ((globalThis as { __grokbotKanban?: { board?: BoardHandle } }).__grokbotKanban ??= {});

export function getBoard(): BoardHandle {
	if (cache.board) return cache.board;
	const config = env();
	const cursor = createCursorClient({ apiKey: config.cursorApiKey });
	if (config.databaseUrl === "pglite") {
		cache.board = lazyPgliteBoard(cursor);
		return cache.board;
	}
	const sql = neon(config.databaseUrl);
	const db = drizzleNeon(sql, { schema });
	cache.board = openBoard({
		store: createStore(db as never),
		cursor,
		now: () => Date.now() as never,
		newId: () => crypto.randomUUID(),
	});
	return cache.board;
}

function lazyPgliteBoard(cursor: ReturnType<typeof createCursorClient>): BoardHandle {
	let ready: Promise<BoardHandle> | null = null;
	const open = () => {
		ready ??= openLocalPglite(cursor);
		return ready;
	};
	// Every capability view forwards each call to the real board once PGlite is ready.
	const defer = <T extends object>(pick: (board: BoardHandle) => T): T =>
		new Proxy({} as T, {
			get: (_target, key) =>
				async (...args: unknown[]) => {
					const target = pick(await open()) as Record<PropertyKey, (...rest: unknown[]) => unknown>;
					return target[key]?.(...args);
				},
		});
	return {
		owner: (cap) => defer((board) => board.owner(cap)),
		bot: (cap) => defer((board) => board.bot(cap)),
		cron: (cap) => defer((board) => board.cron(cap)),
	};
}

async function openLocalPglite(cursor: ReturnType<typeof createCursorClient>): Promise<BoardHandle> {
	const client = new PGlite();
	await client.exec(migrationSql());
	const db = drizzlePglite(client, { schema });
	return openBoard({
		store: createStore(db as never),
		cursor,
		now: () => Date.now() as never,
		newId: () => crypto.randomUUID(),
	});
}

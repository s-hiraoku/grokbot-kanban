import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { openBoard, type BoardHandle } from "./board";
import { migrationSql } from "./migrations";
import { createStore } from "./store";
import * as schema from "./schema";

export type Env = {
	databaseUrl: string;
	ownerPassword: string;
	botToken: string;
	studioUrl: string | null;
};

const MIN_SECRET = 32;

export function env(source: NodeJS.ProcessEnv = process.env): Env {
	const databaseUrl = required(source, "DATABASE_URL");
	const ownerPassword = required(source, "OWNER_PASSWORD");
	const botToken = required(source, "BOT_TOKEN");
	const problems: string[] = [];
	if (ownerPassword.length < MIN_SECRET) problems.push("OWNER_PASSWORD must be at least 32 characters");
	if (botToken.length < MIN_SECRET) problems.push("BOT_TOKEN must be at least 32 characters");
	if (ownerPassword === botToken) problems.push("OWNER_PASSWORD and BOT_TOKEN must differ");
	const studio = source.STUDIO_URL?.trim() || null;
	if (studio && !studio.startsWith("https://")) problems.push("STUDIO_URL must start with https://");
	if (problems.length) throw new Error(problems.join("; "));
	return { databaseUrl, ownerPassword, botToken, studioUrl: studio };
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
	if (config.databaseUrl === "pglite") {
		cache.board = lazyPgliteBoard();
		return cache.board;
	}
	const sql = neon(config.databaseUrl);
	const db = drizzleNeon(sql, { schema });
	cache.board = openBoard({
		store: createStore(db as never),
		now: () => Date.now() as never,
	});
	return cache.board;
}

function lazyPgliteBoard(): BoardHandle {
	let ready: Promise<BoardHandle> | null = null;
	const open = () => {
		ready ??= openLocalPglite();
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
	};
}

async function openLocalPglite(): Promise<BoardHandle> {
	const client = new PGlite();
	await client.exec(migrationSql());
	const db = drizzlePglite(client, { schema });
	return openBoard({
		store: createStore(db as never),
		now: () => Date.now() as never,
	});
}

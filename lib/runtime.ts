import { readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { openBoard, type BoardHandle } from "./board";
import { createCursorClient } from "./cursor";
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

const cache: { board?: BoardHandle } = {};

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
	return {
		owner(cap) {
			return {
				view: async () => (await open()).owner(cap).view(),
				sync: async () => (await open()).owner(cap).sync(),
				execute: async (command) => (await open()).owner(cap).execute(command),
			};
		},
		bot(cap) {
			return {
				create: async (input) => (await open()).bot(cap).create(input),
				patch: async (id, patch) => (await open()).bot(cap).patch(id, patch),
				get: async (id) => (await open()).bot(cap).get(id),
			};
		},
		cron(cap) {
			return { sync: async () => (await open()).cron(cap).sync() };
		},
	};
}

async function openLocalPglite(cursor: ReturnType<typeof createCursorClient>): Promise<BoardHandle> {
	const client = new PGlite();
	const sql = readFileSync(path.join(process.cwd(), "drizzle/0000_init.sql"), "utf8");
	await client.exec(sql);
	const db = drizzlePglite(client, { schema });
	return openBoard({
		store: createStore(db as never),
		cursor,
		now: () => Date.now() as never,
		newId: () => crypto.randomUUID(),
	});
}

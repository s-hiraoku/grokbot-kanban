import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { openBoard, type BoardHandle } from "./board";
import { createAccounts, type Accounts, type Db } from "./accounts";
import { createCursorClient } from "./cursor";
import { createGitHubOAuth, type GitHubOAuth } from "./github";
import { migrationSql } from "./migrations";
import { createStore } from "./store";
import * as schema from "./schema";

export type Env = {
	databaseUrl: string;
	/** The GitHub OAuth app people sign in with. */
	githubClientId: string;
	githubClientSecret: string;
	/** The only GitHub account that may sign in, until each user gets a board of their own. */
	ownerGithubLogin: string;
	/** Where GitHub's sign-in pages and API live. Only the browser tests change them, to point at a stand-in. */
	githubWebUrl: string | null;
	githubApiUrl: string | null;
	botToken: string;
	studioUrl: string | null;
	/** Optional. With it, Run can hand cards to a Cursor cloud agent. */
	cursorApiKey: string | null;
	/** Where the Cursor API lives. Only the browser tests change it, to point at a stand-in. */
	cursorApiUrl: string | null;
};

const MIN_SECRET = 32;

export function env(source: NodeJS.ProcessEnv = process.env): Env {
	const databaseUrl = required(source, "DATABASE_URL");
	const githubClientId = required(source, "GITHUB_CLIENT_ID");
	const githubClientSecret = required(source, "GITHUB_CLIENT_SECRET");
	const ownerGithubLogin = required(source, "OWNER_GITHUB_LOGIN").replace(/^@/, "");
	const botToken = required(source, "BOT_TOKEN");
	const problems: string[] = [];
	if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(ownerGithubLogin)) problems.push("OWNER_GITHUB_LOGIN must be a GitHub username");
	if (botToken.length < MIN_SECRET) problems.push("BOT_TOKEN must be at least 32 characters");
	if (botToken === githubClientSecret) problems.push("BOT_TOKEN and GITHUB_CLIENT_SECRET must differ");
	const studio = source.STUDIO_URL?.trim() || null;
	if (studio && !studio.startsWith("https://")) problems.push("STUDIO_URL must start with https://");
	const cursorApiKey = source.CURSOR_API_KEY?.trim() || null;
	if (cursorApiKey && (cursorApiKey === githubClientSecret || cursorApiKey === botToken)) problems.push("CURSOR_API_KEY must differ from GITHUB_CLIENT_SECRET and BOT_TOKEN");
	const cursorApiUrl = source.CURSOR_API_URL?.trim() || null;
	const githubWebUrl = source.GITHUB_WEB_URL?.trim() || null;
	const githubApiUrl = source.GITHUB_API_URL?.trim() || null;
	if (problems.length) throw new Error(problems.join("; "));
	return { databaseUrl, githubClientId, githubClientSecret, ownerGithubLogin, githubWebUrl, githubApiUrl, botToken, studioUrl: studio, cursorApiKey, cursorApiUrl };
}

function required(source: NodeJS.ProcessEnv, name: string): string {
	const value = source[name]?.trim() ?? "";
	if (!value) throw new Error(`${name} is required`);
	return value;
}

// Next bundles each route separately, so a module-level cache would give every route its own local PGlite.
const cache = ((globalThis as { __grokbotKanban?: { board?: BoardHandle; accounts?: Accounts; db?: Promise<Db> } }).__grokbotKanban ??= {});

/** The database, opened once. A local PGlite gets the schema on first use. */
function database(): Promise<Db> {
	if (cache.db) return cache.db;
	const config = env();
	if (config.databaseUrl === "pglite") {
		cache.db = (async () => {
			const client = new PGlite();
			await client.exec(migrationSql());
			return drizzlePglite(client, { schema }) as never as Db;
		})();
	} else {
		cache.db = Promise.resolve(neonDb(config.databaseUrl));
	}
	return cache.db;
}

function neonDb(url: string): Db {
	return drizzleNeon(neon(url), { schema }) as never as Db;
}

export function getBoard(): BoardHandle {
	if (cache.board) return cache.board;
	const config = env();
	const cursor = config.cursorApiKey ? createCursorClient({ apiKey: config.cursorApiKey, baseUrl: config.cursorApiUrl ?? undefined }) : null;
	if (config.databaseUrl !== "pglite") {
		cache.board = openBoard({ store: createStore(neonDb(config.databaseUrl) as never), now: () => Date.now() as never, cursor });
		return cache.board;
	}
	let ready: Promise<BoardHandle> | null = null;
	const open = () => {
		ready ??= database().then((db) => openBoard({ store: createStore(db as never), now: () => Date.now() as never, cursor }));
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
	cache.board = {
		owner: (cap) => defer((board) => board.owner(cap)),
		bot: (cap) => defer((board) => board.bot(cap)),
	};
	return cache.board;
}

export function getAccounts(): Accounts {
	cache.accounts ??= {
		signIn: async (...args) => createAccounts(await database()).signIn(...args),
		userFor: async (...args) => createAccounts(await database()).userFor(...args),
		signOut: async (...args) => createAccounts(await database()).signOut(...args),
	};
	return cache.accounts;
}

export function getGitHub(config: Env = env()): GitHubOAuth {
	return createGitHubOAuth({
		clientId: config.githubClientId,
		clientSecret: config.githubClientSecret,
		webUrl: config.githubWebUrl ?? undefined,
		apiUrl: config.githubApiUrl ?? undefined,
	});
}

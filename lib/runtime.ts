import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { openBoard, type BoardHandle } from "./board";
import { createAccounts, type Accounts, type Db } from "./accounts";
import { isOwnerLogin } from "./access";
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
	/** The account that owns the board from before accounts, the old shared BOT_TOKEN, and CURSOR_API_KEY. */
	ownerGithubLogin: string;
	/** Who else may sign in: GitHub usernames, lowercased, or "*" for anyone with a GitHub account. */
	allowedGithubLogins: readonly string[] | "*";
	/** Where GitHub's sign-in pages and API live. Only the browser tests change them, to point at a stand-in. */
	githubWebUrl: string | null;
	githubApiUrl: string | null;
	/** The old shared Bot token. It still works, as the owner's, until the Bots move to tokens made on the board. */
	botToken: string | null;
	studioUrl: string | null;
	/** Optional. With it, Run can hand cards to a Cursor cloud agent. */
	cursorApiKey: string | null;
	/** Where the Cursor API lives. Only the browser tests change it, to point at a stand-in. */
	cursorApiUrl: string | null;
};

const MIN_SECRET = 32;
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;


export function env(source: NodeJS.ProcessEnv = process.env): Env {
	const databaseUrl = required(source, "DATABASE_URL");
	const githubClientId = required(source, "GITHUB_CLIENT_ID");
	const githubClientSecret = required(source, "GITHUB_CLIENT_SECRET");
	const ownerGithubLogin = required(source, "OWNER_GITHUB_LOGIN").replace(/^@/, "");
	const botToken = source.BOT_TOKEN?.trim() || null;
	const problems: string[] = [];
	if (!GITHUB_LOGIN.test(ownerGithubLogin)) problems.push("OWNER_GITHUB_LOGIN must be a GitHub username");
	const allowedRaw = source.ALLOWED_GITHUB_LOGINS?.trim() ?? "";
	const allowedGithubLogins =
		allowedRaw === "*"
			? "*"
			: allowedRaw
					.split(/[\s,]+/)
					.map((login) => login.replace(/^@/, "").toLowerCase())
					.filter(Boolean);
	if (allowedGithubLogins !== "*" && allowedGithubLogins.some((login) => !GITHUB_LOGIN.test(login))) problems.push('ALLOWED_GITHUB_LOGINS must be GitHub usernames separated by commas, or "*"');
	if (botToken && botToken.length < MIN_SECRET) problems.push("BOT_TOKEN must be at least 32 characters");
	if (botToken && botToken === githubClientSecret) problems.push("BOT_TOKEN and GITHUB_CLIENT_SECRET must differ");
	const studio = source.STUDIO_URL?.trim() || null;
	if (studio && !studio.startsWith("https://")) problems.push("STUDIO_URL must start with https://");
	const cursorApiKey = source.CURSOR_API_KEY?.trim() || null;
	if (cursorApiKey && (cursorApiKey === githubClientSecret || cursorApiKey === botToken)) problems.push("CURSOR_API_KEY must differ from GITHUB_CLIENT_SECRET and BOT_TOKEN");
	const cursorApiUrl = source.CURSOR_API_URL?.trim() || null;
	const githubWebUrl = source.GITHUB_WEB_URL?.trim() || null;
	const githubApiUrl = source.GITHUB_API_URL?.trim() || null;
	if (problems.length) throw new Error(problems.join("; "));
	return { databaseUrl, githubClientId, githubClientSecret, ownerGithubLogin, allowedGithubLogins, githubWebUrl, githubApiUrl, botToken, studioUrl: studio, cursorApiKey, cursorApiUrl };
}

function required(source: NodeJS.ProcessEnv, name: string): string {
	const value = source[name]?.trim() ?? "";
	if (!value) throw new Error(`${name} is required`);
	return value;
}

// Next bundles each route separately, so a module-level cache would give every route its own local PGlite.
const cache = ((globalThis as { __grokbotKanban?: { boards?: Map<string, BoardHandle>; accounts?: Accounts; db?: Promise<Db> } }).__grokbotKanban ??= {});

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
		cache.db = Promise.resolve(drizzleNeon(neon(config.databaseUrl), { schema }) as never as Db);
	}
	return cache.db;
}

/**
 * One user's board. Only the owner's board gets Cursor, since CURSOR_API_KEY is the owner's Cursor account and
 * would let anyone else start agents on the owner's repositories.
 */
export function getBoard(user: { id: string; login: string }): BoardHandle {
	const boards = (cache.boards ??= new Map());
	const known = boards.get(user.id);
	if (known) return known;
	const config = env();
	const cursor = config.cursorApiKey && isOwnerLogin(user.login, config) ? createCursorClient({ apiKey: config.cursorApiKey, baseUrl: config.cursorApiUrl ?? undefined }) : null;
	let ready: Promise<BoardHandle> | null = null;
	const open = () => {
		ready ??= database().then((db) => openBoard({ store: createStore(db as never, user.id), now: () => Date.now() as never, cursor }));
		return ready;
	};
	// Every capability view forwards each call to the real board once the database is open.
	const defer = <T extends object>(pick: (board: BoardHandle) => T): T =>
		new Proxy({} as T, {
			get: (_target, key) =>
				async (...args: unknown[]) => {
					const target = pick(await open()) as Record<PropertyKey, (...rest: unknown[]) => unknown>;
					return target[key]?.(...args);
				},
		});
	const board: BoardHandle = {
		owner: (cap) => defer((handle) => handle.owner(cap)),
		bot: (cap) => defer((handle) => handle.bot(cap)),
	};
	boards.set(user.id, board);
	return board;
}

export function getAccounts(): Accounts {
	// Each call waits for the database, so routes can use accounts before a local PGlite has opened.
	cache.accounts ??= new Proxy({} as Accounts, {
		get: (_target, key) =>
			async (...args: unknown[]) => {
				const accounts = createAccounts(await database()) as unknown as Record<PropertyKey, (...rest: unknown[]) => unknown>;
				return accounts[key]?.(...args);
			},
	});
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

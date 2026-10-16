import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { openBoard, type BoardHandle, type OwnerCommand } from "@/lib/board";
import { createCursorClient, type CursorClient } from "@/lib/cursor";
import type { Instant } from "@/lib/domain";
import { sessionCookie } from "@/lib/auth";
import * as schema from "@/lib/schema";
import { migrationSql } from "@/lib/migrations";
import { createStore } from "@/lib/store";
import type { Env } from "@/lib/runtime";

export const PASSWORD = "a".repeat(32);
export const BOT_TOKEN = "b".repeat(32);
export const CRON_SECRET = "c".repeat(32);
export const CURSOR_KEY = "d".repeat(32);

export type FakeRun = {
	status: string;
	git?: { branches: { repoUrl: string; branch?: string; prUrl?: string }[] };
};

export type FakeCursor = {
	fetch: typeof fetch;
	created: { prompt: { text: string }; repos: { url: string; startingRef: string }[]; autoCreatePR: boolean }[];
	cancelled: string[];
	setRun: (agentId: string, run: FakeRun) => void;
	failNext: (kind: "unknown" | "rejected") => void;
};

export type TestApp = {
	board: BoardHandle;
	env: Env;
	cursor: FakeCursor;
	client: PGlite;
	setNow: (value: number) => void;
	now: () => number;
	cookie: string;
};

export async function boot(): Promise<TestApp> {
	const client = new PGlite();
	await client.exec(migrationSql());
	const db = drizzle(client, { schema });
	const cursor = fakeCursor();
	let now = Date.parse("2026-10-11T00:00:00.000Z");
	const api: CursorClient = createCursorClient({
		apiKey: CURSOR_KEY,
		fetch: cursor.fetch,
		baseUrl: "https://api.cursor.com",
	});
	const board = openBoard({
		store: createStore(db as never),
		cursor: api,
		now: () => now as Instant,
		newId: () => crypto.randomUUID(),
	});
	const env: Env = {
		databaseUrl: "postgres://test",
		cursorApiKey: CURSOR_KEY,
		ownerPassword: PASSWORD,
		botToken: BOT_TOKEN,
		cronSecret: CRON_SECRET,
		studioUrl: null,
	};
	return {
		board,
		env,
		cursor,
		client,
		setNow: (value) => {
			now = value;
		},
		now: () => now,
		cookie: sessionCookie(PASSWORD, Date.now(), false).split(";")[0] ?? "",
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

export function cronRequest(token: string | null): Request {
	return new Request("http://localhost:3000/api/cron/tick", {
		method: "GET",
		headers: token ? { Authorization: `Bearer ${token}` } : {},
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

function fakeCursor(): FakeCursor {
	const runs = new Map<string, { runId: string; run: FakeRun }>();
	const created: FakeCursor["created"] = [];
	const cancelled: string[] = [];
	let failure: "unknown" | "rejected" | null = null;
	let n = 0;

	const fetchImpl: typeof fetch = async (input, init) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (url.endsWith("/v1/agents") && method === "POST") {
			if (failure === "unknown") {
				failure = null;
				return new Response("upstream", { status: 503 });
			}
			if (failure === "rejected") {
				failure = null;
				return Response.json(
					{ error: { code: "repository_access", message: "Cursor cannot access github.com/s-hiraoku/grokbot." } },
					{ status: 400 },
				);
			}
			const body = JSON.parse(String(init?.body)) as FakeCursor["created"][number];
			n += 1;
			const suffix = String(n).padStart(12, "0");
			const agentId = `bc-00000000-0000-0000-0000-${suffix}`;
			const runId = `run-00000000-0000-0000-0000-${suffix}`;
			created.push(body);
			runs.set(agentId, { runId, run: { status: "CREATING" } });
			return Response.json({
				agent: {
					id: agentId,
					latestRunId: runId,
					url: `https://cursor.com/agents/${agentId}`,
					status: "ACTIVE",
				},
				run: { id: runId, status: "CREATING" },
			});
		}
		const cancel = url.match(/\/v1\/agents\/([^/]+)\/runs\/([^/]+)\/cancel$/);
		if (cancel && method === "POST") {
			cancelled.push(cancel[2] ?? "");
			return Response.json({ id: cancel[2] });
		}
		const get = url.match(/\/v1\/agents\/([^/]+)\/runs\/([^/]+)$/);
		if (get && method === "GET") {
			const found = runs.get(get[1] ?? "");
			if (!found) return new Response("missing", { status: 404 });
			return Response.json({
				id: found.runId,
				agentId: get[1],
				status: found.run.status,
				createdAt: "2026-10-11T00:00:00.000Z",
				updatedAt: "2026-10-11T00:01:00.000Z",
				git: found.run.git,
			});
		}
		return new Response("not found", { status: 404 });
	};

	return {
		fetch: fetchImpl,
		created,
		cancelled,
		setRun(agentId, run) {
			const found = runs.get(agentId);
			if (!found) throw new Error(`missing agent ${agentId}`);
			found.run = run;
		},
		failNext(kind) {
			failure = kind;
		},
	};
}

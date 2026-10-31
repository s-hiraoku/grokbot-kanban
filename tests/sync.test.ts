import { beforeEach, expect, test, vi } from "vitest";
import { mintBot } from "@/lib/auth";
import type { AgentRequest, CursorClient, RunObservation } from "@/lib/cursor";
import type { AgentRef } from "@/lib/domain";
import { boot, ownerRequest, syncRequest, type TestApp } from "./kit";

const holder: { current?: TestApp } = {};

vi.mock("@/lib/runtime", () => ({
	getBoard: (user: { id: string; login: string }) => holder.current!.boardFor(user),
	getAccounts: () => holder.current!.accounts,
	env: () => holder.current!.env,
}));

const { POST: sync } = await import("@/app/api/owner/sync/route");
const { POST: command } = await import("@/app/api/owner/commands/route");

beforeEach(async () => {
	holder.current = await boot();
});

function withEtag(app: TestApp, etag: string | null): Request {
	const headers = new Headers({ Origin: "http://localhost:3000", Cookie: app.cookie });
	if (etag) headers.set("If-None-Match", etag);
	return new Request("http://localhost:3000/api/owner/sync", { method: "POST", headers });
}

test("an unchanged board answers 304, and a new card comes back in full", async () => {
	const app = holder.current!;
	const first = await sync(syncRequest(app));
	expect(first.status).toBe(200);
	const etag = first.headers.get("ETag");
	expect(etag).toMatch(/^"\d+"$/);

	const again = await sync(withEtag(app, etag));
	expect(again.status).toBe(304);
	expect(await again.text()).toBe("");
	expect(again.headers.get("ETag")).toBe(etag);

	const created = await command(ownerRequest(app, { type: "create", content: { title: "Fresh" } }));
	expect(created.status).toBe(200);
	expect(created.headers.get("ETag")).toMatch(/^"\d+"$/);
	expect(created.headers.get("ETag")).not.toBe(etag);

	const third = await sync(withEtag(app, etag));
	expect(third.status).toBe(200);
	const body = (await third.json()) as { columns: { cards: { title: string }[] }[] };
	expect(body.columns.some((column) => column.cards.some((card) => card.title === "Fresh"))).toBe(true);
	expect(third.headers.get("ETag")).toBe(created.headers.get("ETag"));
});

test("a bot heartbeat leaves the owner's copy unchanged", async () => {
	const app = holder.current!;
	await app.board.bot(mintBot()).list({}, "Ops");
	const first = await sync(syncRequest(app));
	const etag = first.headers.get("ETag");

	await app.board.bot(mintBot()).list({}, "Ops");
	const again = await sync(withEtag(app, etag));
	expect(again.status).toBe(304);
	expect(await again.text()).toBe("");
});

test("a Cursor run still returns the board until the run is gone", async () => {
	const cursor = fakeCursor();
	holder.current = await boot({ cursor: cursor.client });
	const app = holder.current;
	const created = await command(
		ownerRequest(app, {
			type: "create",
			content: { title: "Fix the redirect", repo: { url: "https://github.com/s-hiraoku/shift-log", startingRef: "main" } },
		}),
	);
	const board = (await created.json()) as { board: { columns: { cards: { id: string; title: string }[] }[] } };
	const cardId = board.board.columns.flatMap((column) => column.cards).find((card) => card.title === "Fix the redirect")?.id;
	expect(cardId).toBeTruthy();

	const launched = await command(ownerRequest(app, { type: "cursor", cardId }));
	expect(launched.status).toBe(200);
	const etag = launched.headers.get("ETag");

	const during = await sync(withEtag(app, etag));
	expect(during.status).toBe(200);

	cursor.run = { phase: "ended", outcome: "finished", pullRequests: [{ repoKey: "github.com/s-hiraoku/shift-log", url: "https://github.com/s-hiraoku/shift-log/pull/3" }] };
	app.setNow(app.now() + 21_000);
	const landed = await sync(syncRequest(app));
	expect(landed.status).toBe(200);
	const landedBody = (await landed.json()) as { columns: { cards: { id: string; cursor: unknown }[] }[] };
	const landedCard = landedBody.columns.flatMap((column) => column.cards).find((card) => card.id === cardId);
	expect(landedCard?.cursor).toBeNull();

	const quiet = await sync(withEtag(app, landed.headers.get("ETag")));
	expect(quiet.status).toBe(304);
});

test("another user's edit leaves this board on 304", async () => {
	const app = holder.current!;
	app.env = { ...app.env, allowedGithubLogins: ["alice"] };
	const { token } = await app.accounts.signIn({ id: 1001, login: "alice", name: "Alice", avatarUrl: null }, Date.now());
	const alice: TestApp = { ...app, cookie: `kanban_session=${token}` };

	const first = await sync(syncRequest(alice));
	expect(first.status).toBe(200);
	const etag = first.headers.get("ETag");

	const created = await command(ownerRequest(app, { type: "create", content: { title: "Owner only" } }));
	expect(created.status).toBe(200);
	expect(created.headers.get("ETag")).not.toBe(etag);

	const again = await sync(withEtag(alice, etag));
	expect(again.status).toBe(304);
	expect(again.headers.get("ETag")).toBe(etag);
});

function fakeCursor() {
	const fake = {
		run: { phase: "active", status: "RUNNING" } as RunObservation | "unreachable",
		client: {} as CursorClient,
	};
	fake.client = {
		createAgent: async (_request: AgentRequest) => ({ kind: "created", agent: { agentId: "bc-1", runId: "run-1", url: "https://cursor.com/agents/bc-1" } }),
		getRun: async (_agent: AgentRef) => fake.run,
		cancelRun: async () => "requested",
	};
	return fake;
}

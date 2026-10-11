import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Card, CardContent, CardId, CardState, ContentPatch, HttpsUrl, Instant } from "./domain";
import { cards } from "./schema";

type QueryDb = {
	select: () => {
		from: (table: typeof cards) => Promise<Row[]> & { where: (condition: unknown) => Promise<Row[]> };
	};
	insert: (table: typeof cards) => {
		values: (value: Record<string, unknown>) => { returning: () => Promise<Row[]> };
	};
	update: (table: typeof cards) => {
		set: (value: Record<string, unknown>) => {
			where: (condition: unknown) => { returning: () => Promise<Row[]> };
		};
	};
};

type Row = {
	id: string;
	createdAt: Date;
	externalId: string | null;
	title: string;
	body: string;
	notes: string;
	repo: unknown;
	source: string | null;
	originalLink: string | null;
	priority: string;
	kind: unknown;
	screening: unknown;
	rank: string;
	state: unknown;
	stateVersion: number;
};

export type WriteResult = "written" | "conflict" | "slotTaken";

export type Store = {
	all(): Promise<Card[]>;
	get(id: CardId): Promise<Card | null>;
	insert(row: { externalId: string | null; content: CardContent; rank: string; now: Instant }): Promise<{
		card: Card;
		created: boolean;
	}>;
	patchContent(id: CardId, patch: ContentPatch): Promise<Card | null>;
	writeState(id: CardId, expectedVersion: number, next: { state: CardState; rank: string }): Promise<WriteResult>;
};

const slot = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const agentRef = z.object({ agentId: z.string(), runId: z.string(), url: z.string() });
const launch = z.object({
	id: z.string(),
	requestedAt: z.number(),
	request: z.object({
		promptText: z.string(),
		repo: z.object({ url: z.string(), startingRef: z.string() }),
	}),
});
const runRecord = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("ended"),
		launchId: z.string(),
		endedAt: z.number(),
		agent: agentRef,
		outcome: z.enum(["finished", "error", "cancelled", "expired"]),
		prUrl: z.string().nullable(),
	}),
	z.object({
		kind: z.literal("launchFailed"),
		launchId: z.string(),
		endedAt: z.number(),
		message: z.string(),
	}),
	z.object({ kind: z.literal("launchLost"), launchId: z.string(), endedAt: z.number() }),
]);
const stateSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("idle"), column: z.enum(["inbox", "todo", "done", "wontDo"]), last: runRecord.nullable() }),
	z.object({ kind: z.literal("queued"), launch, last: runRecord.nullable() }),
	z.object({ kind: z.literal("starting"), launch, slot, claimedAt: z.number() }),
	z.object({ kind: z.literal("running"), launch, slot, agent: agentRef, cursorStatus: z.string() }),
	z.object({ kind: z.literal("stopping"), launch, slot, agent: agentRef, requestedAt: z.number() }),
	z.object({
		kind: z.literal("review"),
		run: runRecord.options[0].extend({ prUrl: z.string() }),
	}),
]);

const contentSchema = z.object({
	title: z.string(),
	body: z.string(),
	notes: z.string(),
	repo: z.object({ url: z.string(), startingRef: z.string() }).nullable(),
	source: z.string().nullable(),
	originalLink: z.string().nullable(),
	priority: z.enum(["low", "normal", "high"]),
	kind: z.discriminatedUnion("type", [
		z.object({ type: z.literal("text") }),
		z.object({ type: z.literal("voice"), seconds: z.number() }),
	]),
	screening: z.object({ by: z.string().nullable() }).nullable(),
});

const idleInbox: CardState = { kind: "idle", column: "inbox", last: null };

export function createStore(db: QueryDb): Store {
	return {
		async all() {
			const rows = await db.select().from(cards);
			return rows.map(readCard).sort((a, b) => Number(a.rank) - Number(b.rank) || a.id.localeCompare(b.id));
		},
		async get(id) {
			const rows = await db.select().from(cards).where(eq(cards.id, id));
			const row = rows[0];
			return row ? readCard(row) : null;
		},
		async insert(row) {
			if (row.externalId) {
				const existing = await findExternal(db, row.externalId);
				if (existing) return { card: existing, created: false };
			}
			try {
				const inserted = await db
					.insert(cards)
					.values(contentValues(row.content, {
						id: crypto.randomUUID(),
						createdAt: new Date(row.now),
						externalId: row.externalId,
						rank: row.rank,
						state: idleInbox,
						stateVersion: 0,
					}))
					.returning();
				const created = inserted[0];
				if (!created) throw new Error("insert returned no row");
				return { card: readCard(created), created: true };
			} catch (error) {
				if (row.externalId && pgCode(error) === "23505") {
					const existing = await findExternal(db, row.externalId);
					if (existing) return { card: existing, created: false };
				}
				throw error;
			}
		},
		async patchContent(id, patch) {
			const current = await db.select().from(cards).where(eq(cards.id, id));
			const row = current[0];
			if (!row) return null;
			const content = readContent(row);
			const next = { ...content, ...patch };
			const updated = await db
				.update(cards)
				.set(contentColumns(next))
				.where(eq(cards.id, id))
				.returning();
			const written = updated[0];
			return written ? readCard(written) : null;
		},
		async writeState(id, expectedVersion, next) {
			try {
				const updated = await db
					.update(cards)
					.set({
						state: next.state,
						rank: next.rank,
						stateVersion: sql`${cards.stateVersion} + 1`,
					})
					.where(and(eq(cards.id, id), eq(cards.stateVersion, expectedVersion)))
					.returning();
				return updated.length === 0 ? "conflict" : "written";
			} catch (error) {
				if (pgCode(error) === "23505") return "slotTaken";
				throw error;
			}
		},
	};
}

async function findExternal(db: QueryDb, externalId: string): Promise<Card | null> {
	const rows = await db.select().from(cards).where(eq(cards.externalId, externalId));
	const row = rows[0];
	return row ? readCard(row) : null;
}

function contentValues(
	content: CardContent,
	meta: { id: string; createdAt: Date; externalId: string | null; rank: string; state: CardState; stateVersion: number },
): Record<string, unknown> {
	return { ...meta, ...contentColumns(content) };
}

function contentColumns(content: CardContent): Record<string, unknown> {
	return {
		title: content.title,
		body: content.body,
		notes: content.notes,
		repo: content.repo,
		source: content.source,
		originalLink: content.originalLink,
		priority: content.priority,
		kind: content.kind,
		screening: content.screening,
	};
}

function readCard(row: Row): Card {
	const content = readContent(row);
	const state = stateSchema.parse(row.state) as CardState;
	return {
		id: row.id as CardId,
		createdAt: new Date(row.createdAt).getTime() as Instant,
		rank: row.rank,
		content,
		state,
		version: row.stateVersion,
	};
}

function readContent(row: Row): CardContent {
	const parsed = contentSchema.parse({
		title: row.title,
		body: row.body,
		notes: row.notes,
		repo: row.repo,
		source: row.source,
		originalLink: row.originalLink,
		priority: row.priority,
		kind: row.kind,
		screening: row.screening,
	});
	return {
		...parsed,
		repo: parsed.repo ? { url: parsed.repo.url as HttpsUrl, startingRef: parsed.repo.startingRef } : null,
		originalLink: (parsed.originalLink as HttpsUrl | null) ?? null,
	};
}

export function pgCode(error: unknown): string | undefined {
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		if ("code" in current && typeof current.code === "string") return current.code;
		if ("cause" in current) {
			current = current.cause;
			continue;
		}
		break;
	}
	const message = error instanceof Error ? error.message : String(error);
	const match = message.match(/\b(23505|23514|428C9)\b/);
	return match?.[1];
}

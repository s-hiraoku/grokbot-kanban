import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { BotProfile, BotProfilePatch } from "./bots";
import type { BotRun, Card, CardContent, CardId, CardState, Column, ContentPatch, CursorRun, HttpsUrl, Instant, MemberId, PastRun } from "./domain";
import { bots, cards } from "./schema";

type QueryDb = {
	select: () => {
		from: <R = Row>(table: typeof cards | typeof bots) => Promise<R[]> & { where: (condition: unknown) => Promise<R[]> };
	};
	insert: (table: typeof cards | typeof bots) => {
		values: (value: Record<string, unknown>) => {
			returning: <R = Row>() => Promise<R[]>;
			onConflictDoNothing: () => { returning: <R = Row>() => Promise<R[]> };
		};
	};
	update: (table: typeof cards | typeof bots) => {
		set: (value: Record<string, unknown>) => {
			where: (condition: unknown) => { returning: <R = Row>() => Promise<R[]> };
		};
	};
	delete: (table: typeof cards | typeof bots) => { where: (condition: unknown) => { returning: <R = Row>() => Promise<R[]> } };
};

type BotRow = {
	id: string;
	name: string;
	role: string;
	avatar: string | null;
	color: string;
	createdAt: Date;
	lastSeenAt: Date | null;
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
	assignees: unknown;
	createdBy: string | null;
	rank: string;
	state: unknown;
	stateVersion: number;
};

export type WriteResult = "written" | "conflict";

export type Store = {
	all(): Promise<Card[]>;
	get(id: CardId): Promise<Card | null>;
	insert(row: {
		externalId: string | null;
		content: CardContent;
		rank: string;
		now: Instant;
		createdBy: MemberId | null;
	}): Promise<{
		card: Card;
		created: boolean;
	}>;
	patchContent(id: CardId, patch: ContentPatch): Promise<Card | null>;
	writeState(id: CardId, expectedVersion: number, next: { state: CardState; rank: string }): Promise<WriteResult>;
	writeRank(id: CardId, rank: string): Promise<boolean>;
	bots(): Promise<BotProfile[]>;
	bot(id: string): Promise<BotProfile | null>;
	/** Inserts the bot if its id is new. Returns the stored row either way. */
	ensureBot(profile: BotProfile): Promise<BotProfile>;
	updateBot(id: string, patch: BotProfilePatch & { lastSeenAt?: Instant }): Promise<BotProfile | null>;
	deleteBot(id: string): Promise<boolean>;
	deleteCard(id: CardId): Promise<boolean>;
};

const columnSchema = z.enum(["inbox", "todo", "inProgress", "inReview", "done", "wontDo"]);
const pastRun = z.object({
	kind: z.literal("ended"),
	launchId: z.string(),
	endedAt: z.number(),
	agent: z.object({ agentId: z.string(), runId: z.string(), url: z.string() }),
	outcome: z.enum(["finished", "error", "cancelled", "expired"]),
	prUrl: z.string().nullable(),
});
const botRunSchema = z.object({
	bot: z.string(),
	status: z.enum(["requested", "working"]),
	requestedAt: z.number(),
	startedAt: z.number().nullable(),
	passedOn: z.object({ by: z.string(), at: z.number() }).nullable().default(null),
});
const cursorRunSchema = z.object({
	launchId: z.string(),
	status: z.enum(["launching", "running"]),
	agent: z.object({ agentId: z.string(), runId: z.string(), url: z.string() }).nullable(),
	by: z.string(),
	from: columnSchema,
	startedAt: z.number(),
	checkedAt: z.number(),
});
// Earlier versions also stored queued, starting, running, stopping, and review states for Cursor runs.
// Those cards read back in the column they showed in, keeping the links of a run that ended.
const storedState = z
	.object({
		kind: z.string(),
		column: columnSchema.optional(),
		last: z.unknown().optional(),
		run: z.unknown().optional(),
		botRun: z.unknown().optional(),
		cursorRun: z.unknown().optional(),
	})
	.passthrough();
const LEGACY_COLUMN: Record<string, Column> = {
	queued: "todo",
	starting: "inProgress",
	running: "inProgress",
	stopping: "inProgress",
	review: "inReview",
};

export function readState(raw: unknown): CardState {
	const stored = storedState.parse(raw);
	const column = stored.kind === "idle" ? stored.column : LEGACY_COLUMN[stored.kind];
	if (!column) throw new Error(`unknown card state ${stored.kind}`);
	const run = pastRun.safeParse(stored.kind === "review" ? stored.run : stored.last);
	const botRun = botRunSchema.safeParse(stored.botRun);
	const cursorRun = cursorRunSchema.safeParse(stored.cursorRun);
	return {
		kind: "idle",
		column,
		last: run.success ? (run.data as PastRun) : null,
		botRun: botRun.success ? (botRun.data as BotRun) : null,
		cursorRun: cursorRun.success ? (cursorRun.data as CursorRun) : null,
	};
}

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
	assignees: z.array(z.string()),
});

const idleInbox: CardState = { kind: "idle", column: "inbox", last: null, botRun: null, cursorRun: null };

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
						createdBy: row.createdBy,
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
		},
		async writeRank(id, rank) {
			const updated = await db.update(cards).set({ rank }).where(eq(cards.id, id)).returning();
			return updated.length > 0;
		},
		async bots() {
			const rows = await db.select().from<BotRow>(bots);
			return rows.map(readBot).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
		},
		async bot(id) {
			const rows = await db.select().from<BotRow>(bots).where(eq(bots.id, id));
			return rows[0] ? readBot(rows[0]) : null;
		},
		async ensureBot(profile) {
			await db
				.insert(bots)
				.values({
					id: profile.id,
					name: profile.name,
					role: profile.role,
					avatar: profile.avatar,
					color: profile.color,
					createdAt: new Date(profile.createdAt),
					lastSeenAt: profile.lastSeenAt === null ? null : new Date(profile.lastSeenAt),
				})
				.onConflictDoNothing()
				.returning<BotRow>();
			const rows = await db.select().from<BotRow>(bots).where(eq(bots.id, profile.id));
			if (!rows[0]) throw new Error("bot insert returned no row");
			return readBot(rows[0]);
		},
		async updateBot(id, patch) {
			const values: Record<string, unknown> = {};
			if (patch.name !== undefined) values.name = patch.name;
			if (patch.role !== undefined) values.role = patch.role;
			if (patch.avatar !== undefined) values.avatar = patch.avatar;
			if (patch.color !== undefined) values.color = patch.color;
			if (patch.lastSeenAt !== undefined) values.lastSeenAt = new Date(patch.lastSeenAt);
			if (Object.keys(values).length === 0) return this.bot(id);
			const rows = await db.update(bots).set(values).where(eq(bots.id, id)).returning<BotRow>();
			return rows[0] ? readBot(rows[0]) : null;
		},
		async deleteBot(id) {
			const rows = await db.delete(bots).where(eq(bots.id, id)).returning();
			return rows.length > 0;
		},
		async deleteCard(id) {
			const rows = await db.delete(cards).where(eq(cards.id, id)).returning();
			return rows.length > 0;
		},
	};
}

function readBot(row: BotRow): BotProfile {
	return {
		id: row.id,
		name: row.name,
		role: row.role,
		avatar: row.avatar,
		color: row.color,
		createdAt: new Date(row.createdAt).getTime() as Instant,
		lastSeenAt: row.lastSeenAt ? (new Date(row.lastSeenAt).getTime() as Instant) : null,
	};
}

async function findExternal(db: QueryDb, externalId: string): Promise<Card | null> {
	const rows = await db.select().from(cards).where(eq(cards.externalId, externalId));
	const row = rows[0];
	return row ? readCard(row) : null;
}

function contentValues(
	content: CardContent,
	meta: {
		id: string;
		createdAt: Date;
		externalId: string | null;
		createdBy: MemberId | null;
		rank: string;
		state: CardState;
		stateVersion: number;
	},
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
		assignees: [...content.assignees],
	};
}

function readCard(row: Row): Card {
	const content = readContent(row);
	const state = readState(row.state);
	return {
		id: row.id as CardId,
		createdAt: new Date(row.createdAt).getTime() as Instant,
		createdBy: row.createdBy,
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
		assignees: row.assignees ?? [],
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

import { z } from "zod";
import type { CardContent, ContentPatch, HttpsUrl, ParkColumn } from "./domain";

export class BadRequest extends Error {
	constructor(message = "bad_request") {
		super(message);
		this.name = "BadRequest";
	}
}

const httpsUrl = z
	.string()
	.url()
	.refine((value) => value.startsWith("https://"), "https required");

const repoSchema = z.object({
	url: httpsUrl,
	startingRef: z.string().min(1).max(200).default("main"),
});

const kindSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text") }).strict(),
	z.object({ type: z.literal("voice"), seconds: z.number().int().positive().max(3600) }).strict(),
]);

const screeningSchema = z.object({ by: z.string().max(40).nullable() }).strict().nullable();

/** Bot ids or names, "owner", or (for a bot caller) "me". The board resolves them. */
export const memberRefsSchema = z.array(z.string().trim().min(1).max(40)).max(10);

const contentSchema = z
	.object({
		title: z.string().min(1).max(200),
		body: z.string().max(20_000).default(""),
		notes: z.string().max(20_000).default(""),
		repo: repoSchema.nullable().default(null),
		source: z.string().max(200).nullable().default(null),
		originalLink: httpsUrl.nullable().default(null),
		priority: z.enum(["low", "normal", "high"]).default("normal"),
		kind: kindSchema.default({ type: "text" }),
		screening: screeningSchema.default(null),
		assignees: memberRefsSchema.default([]),
	})
	.strict();

export const contentPatchSchema = z
	.object({
		title: z.string().min(1).max(200).optional(),
		body: z.string().max(20_000).optional(),
		notes: z.string().max(20_000).optional(),
		repo: repoSchema.nullable().optional(),
		source: z.string().max(200).nullable().optional(),
		originalLink: httpsUrl.nullable().optional(),
		priority: z.enum(["low", "normal", "high"]).optional(),
		kind: kindSchema.optional(),
		screening: screeningSchema.optional(),
		assignees: memberRefsSchema.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "empty patch");

export const newCardBodySchema = z
	.object({
		externalId: z.string().min(1).max(200).nullable().optional(),
		title: z.string().min(1).max(200),
		body: z.string().max(20_000).optional(),
		notes: z.string().max(20_000).optional(),
		repo: repoSchema.nullable().optional(),
		source: z.string().max(200).nullable().optional(),
		originalLink: httpsUrl.nullable().optional(),
		priority: z.enum(["low", "normal", "high"]).optional(),
		kind: kindSchema.optional(),
		screening: screeningSchema.optional(),
		assignees: memberRefsSchema.optional(),
	})
	.strict();

/** About 90 KB of image once decoded. The board resizes uploads to 128px, which lands far below this. */
export const AVATAR_DATA_MAX = 120_000;

export function isAvatarData(value: string): boolean {
	return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export const botProfileSchema = z
	.object({
		name: z.string().trim().min(1).max(40),
		role: z.string().max(200).default(""),
		// Omitted keeps the current icon. An uploaded image arrives as a small data URL the browser already resized.
		avatar: z
			.string()
			.trim()
			.max(AVATAR_DATA_MAX)
			.nullable()
			.optional()
			.refine(
				(value) => value == null || value === "" || isAvatarData(value) || (value.length <= 500 && (value.startsWith("https://") || Array.from(value).length <= 4)),
				"avatar must be an uploaded image, an https URL, or a short emoji",
			),
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.nullable()
			.default(null),
	})
	.strict();


const columnSchema = z.enum(["inbox", "todo", "inProgress", "inReview", "done", "wontDo"]);

const parkColumn = columnSchema;

export const ownerCommandSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("create"), content: contentSchema }).strict(),
	z.object({ type: z.literal("edit"), cardId: z.string().uuid(), patch: contentPatchSchema }).strict(),
	z.object({ type: z.literal("move"), cardId: z.string().uuid(), to: parkColumn }).strict(),
	z.object({ type: z.literal("run"), cardId: z.string().uuid() }).strict(),
	z.object({ type: z.literal("stop"), cardId: z.string().uuid() }).strict(),
	z
		.object({ type: z.literal("drop"), cardId: z.string().uuid(), column: columnSchema, index: z.number().int().min(0).max(10_000) })
		.strict(),
	z.object({ type: z.literal("saveBot"), id: z.string().min(1).max(64).nullable(), profile: botProfileSchema }).strict(),
	z.object({ type: z.literal("deleteBot"), id: z.string().min(1).max(64) }).strict(),
	z.object({ type: z.literal("deleteCard"), cardId: z.string().uuid() }).strict(),
]);

export function parseJson(raw: unknown): unknown {
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			throw new BadRequest();
		}
	}
	return raw;
}

export function parseBody<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw new BadRequest();
	return parsed.data;
}

export function contentFromNewCard(raw: z.infer<typeof newCardBodySchema>): CardContent {
	const content = contentSchema.parse({
		title: raw.title,
		body: raw.body,
		notes: raw.notes,
		repo: raw.repo,
		source: raw.source,
		originalLink: raw.originalLink,
		priority: raw.priority,
		kind: raw.kind,
		screening: raw.screening,
		assignees: raw.assignees,
	});
	return brandContent(content);
}

export function brandContent(content: z.infer<typeof contentSchema>): CardContent {
	return {
		...content,
		repo: content.repo
			? { url: content.repo.url as HttpsUrl, startingRef: content.repo.startingRef }
			: null,
		originalLink: (content.originalLink as HttpsUrl | null) ?? null,
	};
}

export function brandPatch(patch: z.infer<typeof contentPatchSchema>): ContentPatch {
	const next: ContentPatch = {};
	if (patch.title !== undefined) next.title = patch.title;
	if (patch.body !== undefined) next.body = patch.body;
	if (patch.notes !== undefined) next.notes = patch.notes;
	if (patch.repo !== undefined) {
		next.repo = patch.repo
			? { url: patch.repo.url as HttpsUrl, startingRef: patch.repo.startingRef }
			: null;
	}
	if (patch.source !== undefined) next.source = patch.source;
	if (patch.originalLink !== undefined) next.originalLink = (patch.originalLink as HttpsUrl | null) ?? null;
	if (patch.priority !== undefined) next.priority = patch.priority;
	if (patch.kind !== undefined) next.kind = patch.kind;
	if (patch.screening !== undefined) next.screening = patch.screening;
	if (patch.assignees !== undefined) next.assignees = patch.assignees;
	return next;
}

export function isParkColumn(value: string): value is ParkColumn {
	return columnSchema.safeParse(value).success;
}

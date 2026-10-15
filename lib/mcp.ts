import { z } from "zod";
import { BoardInputError, type BotBoard } from "./board";
import { COLUMNS, type CardId, type ParkColumn } from "./domain";
import { AVATAR_DATA_MAX, BadRequest, brandPatch, isAvatarData, contentFromNewCard, contentPatchSchema, memberRefsSchema, newCardBodySchema } from "./parse";
import type { BotCardView } from "./view";

/**
 * A stateless MCP server over Streamable HTTP. Every POST carries one JSON-RPC message or a batch,
 * and every answer is a plain JSON body. Grok Bot adds it as a Remote HTTPS custom server with an
 * Authorization header, and the xAI API reaches it the same way through a `mcp` tool.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST = MCP_PROTOCOL_VERSIONS[0];

export const MCP_INSTRUCTIONS = `This is the Grok Bot kanban. Cards are work items. Columns: ${COLUMNS.map((c) => `${c.id} (${c.label})`).join(", ")}.
Always pass "bot" with your own Grok Bot name, exactly as in your profile. A new name joins the roster with its own icon.
Start with board_summary to see your assigned cards. Claim a card with assign_card before working on it, and leave findings with add_note so the owner and other bots can follow the handoff.
You can create, edit, assign, annotate, and move cards. Move a card with move_card when its work progresses: to done when finished, wontDo when dropped, todo when ready for work, inbox to send it back. Say why in reason. Moving never starts a Cursor agent, and cards that are queued or running stay with the owner. In Progress and In Review are set by agent runs.
Titles, bodies, and notes may be Japanese.`;

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: unknown };
type JsonRpcResponse =
	| { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
	| { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

export type McpContext = { board: BotBoard; boardUrl: string };

const bot = z.string().trim().min(1).max(40).describe("Your Grok Bot name, as in your Grok Bot profile.");
const cardRef = z
	.string()
	.trim()
	.min(4)
	.max(64)
	.describe("Card id: the full UUID, or the short hex id shown on the card (at least 4 characters).");
const column = z.enum(COLUMNS.map((c) => c.id) as [string, ...string[]]);

const editable = contentPatchSchema.innerType().omit({ notes: true, assignees: true }).shape;

const tools = {
	board_summary: {
		description:
			"Counts per column, running Cursor agents, and the cards assigned to you. Call this first in a session.",
		readOnly: true,
		input: z.object({ bot: bot.optional() }).strict(),
		run: async (ctx: McpContext, args: { bot?: string }) => {
			const summary = await ctx.board.summary(args.bot ?? null);
			return { ...summary, mine: summary.mine.map((card) => compact(card, ctx)) };
		},
	},
	list_cards: {
		description:
			'List cards, newest rank last. Filter by column, by assignee ("me" for yourself, "owner", or a bot name), unassigned only, or a text query.',
		readOnly: true,
		input: z
			.object({
				bot: bot.optional(),
				column: column.optional(),
				assignee: z.string().trim().min(1).max(40).optional(),
				unassigned: z.boolean().optional(),
				query: z.string().trim().min(1).max(200).optional(),
				limit: z.number().int().min(1).max(100).optional(),
			})
			.strict(),
		run: async (ctx: McpContext, args: { bot?: string; column?: string; assignee?: string; unassigned?: boolean; query?: string; limit?: number }) => {
			const cards = await ctx.board.list(
				{
					column: args.column as never,
					assignee: args.assignee,
					unassigned: args.unassigned,
					query: args.query,
					limit: args.limit,
				},
				args.bot ?? null,
			);
			return { count: cards.length, cards: cards.map((card) => compact(card, ctx)) };
		},
	},
	get_card: {
		description: "Read one card in full, including notes, repo, links, and run state.",
		readOnly: true,
		input: z.object({ card: cardRef }).strict(),
		run: async (ctx: McpContext, args: { card: string }) => full(await required(ctx.board.find(args.card)), ctx),
	},
	list_bots: {
		description: "The bot roster: names, roles, icons, and how many cards each one holds.",
		readOnly: true,
		input: z.object({}).strict(),
		run: async (ctx: McpContext) => ({
			bots: (await ctx.board.roster()).map((item) => ({
				id: item.id,
				name: item.name,
				role: item.role,
				avatar: item.avatar,
				assigned: item.assigned,
				lastSeen: item.lastSeen,
			})),
		}),
	},
	create_card: {
		description:
			"File a new card in Inbox. Use externalId (for example the X post id) so a retry returns the same card instead of a duplicate. assignees takes bot names, \"me\", or \"owner\".",
		readOnly: false,
		input: newCardBodySchema.extend({ bot }),
		run: async (ctx: McpContext, args: z.infer<typeof newCardBodySchema> & { bot: string }) => {
			const { bot: actor, externalId, ...rest } = args;
			const result = await ctx.board.create(
				{ externalId: externalId ?? null, content: contentFromNewCard(rest) },
				actor,
			);
			return { created: result.created, card: full(result.card, ctx) };
		},
	},
	update_card: {
		description:
			"Edit a card's title, body, priority, repo, source, link, kind, or screening. Notes and assignees have their own tools. This never moves the card.",
		readOnly: false,
		input: z.object({ bot, card: cardRef, ...editable }).strict(),
		run: async (ctx: McpContext, args: { bot: string; card: string } & Record<string, unknown>) => {
			const { bot: actor, card, ...patch } = args;
			if (Object.keys(patch).length === 0) throw new BoardInputError("nothing to update");
			const parsed = contentPatchSchema.safeParse(patch);
			if (!parsed.success) throw new BoardInputError(parsed.error.issues.map((issue) => issue.message).join("; "));
			const found = await required(ctx.board.find(card));
			return full(await required(ctx.board.patch(found.id as CardId, brandPatch(parsed.data), actor)), ctx);
		},
	},
	add_note: {
		description:
			"Append a timestamped line, signed with your name, to the card's notes. Use it for findings, evidence links, and handoffs.",
		readOnly: false,
		input: z.object({ bot, card: cardRef, text: z.string().trim().min(1).max(4000) }).strict(),
		run: async (ctx: McpContext, args: { bot: string; card: string; text: string }) =>
			full(await required(ctx.board.addNote(args.card, args.text, args.bot)), ctx),
	},
	assign_card: {
		description:
			'Change who holds a card. With no add, remove, or set, it assigns you. Names can be bot names, "me", or "owner". A bot name that is new joins the roster.',
		readOnly: false,
		input: z
			.object({
				bot,
				card: cardRef,
				add: memberRefsSchema.optional(),
				remove: memberRefsSchema.optional(),
				set: memberRefsSchema.optional(),
			})
			.strict(),
		run: async (ctx: McpContext, args: { bot: string; card: string; add?: string[]; remove?: string[]; set?: string[] }) =>
			full(await required(ctx.board.assign(args.card, { add: args.add, remove: args.remove, set: args.set }, args.bot)), ctx),
	},
	move_card: {
		description:
			"Move a card to inbox, todo, done, or wontDo as its work progresses, with a short reason that is signed into the notes. Todo only parks the card: it never starts a Cursor agent. Cards waiting for or running an agent cannot be moved by bots. In Progress and In Review are set by agent runs.",
		readOnly: false,
		input: z
			.object({
				bot,
				card: cardRef,
				to: z.enum(["inbox", "todo", "done", "wontDo"]),
				reason: z.string().max(500).optional().describe("Why it moved, for example the PR that fixed it."),
			})
			.strict(),
		run: async (ctx: McpContext, args: { bot: string; card: string; to: ParkColumn; reason?: string }) =>
			full(await required(ctx.board.move(args.card, args.to, args.reason ?? null, args.bot)), ctx),
	},
	update_my_profile: {
		description:
			"Set how you appear on the board: display name, one-line role, and icon. avatar is a data URL of your profile image (data:image/png;base64,... or jpeg/webp/gif, square, about 128px, under 90 KB), an https image URL, or a single emoji. color is #rrggbb.",
		readOnly: false,
		input: z
			.object({
				bot,
				name: z.string().trim().min(1).max(40).optional(),
				role: z.string().max(200).optional(),
				avatar: z
					.string()
					.trim()
					.max(AVATAR_DATA_MAX)
					.nullable()
					.optional()
					.refine(
						(value) => !value || isAvatarData(value) || (value.length <= 500 && (value.startsWith("https://") || Array.from(value).length <= 4)),
						"avatar must be a base64 image data URL under 90 KB, an https URL, or a short emoji",
					),
				color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
			})
			.strict(),
		run: async (ctx: McpContext, args: { bot: string; name?: string; role?: string; avatar?: string | null; color?: string }) => {
			const { bot: actor, ...patch } = args;
			const profile = await ctx.board.updateProfile(actor, patch);
			// An uploaded image comes back as its board URL, not the whole data URL.
			return { id: profile.id, name: profile.name, role: profile.role, avatar: profile.avatar ? new URL(profile.avatar, ctx.boardUrl).toString() : null, color: profile.color };
		},
	},
} as const;

type ToolName = keyof typeof tools;

export function toolList() {
	return (Object.keys(tools) as ToolName[]).map((name) => {
		const tool = tools[name];
		return {
			name,
			title: name.replaceAll("_", " "),
			description: tool.description,
			inputSchema: jsonSchemaOf(tool.input),
			annotations: {
				readOnlyHint: tool.readOnly,
				destructiveHint: false,
				idempotentHint: tool.readOnly,
				openWorldHint: false,
			},
		};
	});
}

export async function handleMcp(ctx: McpContext, payload: unknown): Promise<{ status: number; body: unknown }> {
	if (Array.isArray(payload)) {
		if (payload.length === 0) return { status: 400, body: rpcError(null, -32600, "empty batch") };
		const answers = (await Promise.all(payload.map((item) => handleOne(ctx, item)))).filter(
			(item): item is JsonRpcResponse => item !== null,
		);
		return answers.length ? { status: 200, body: answers } : { status: 202, body: null };
	}
	const answer = await handleOne(ctx, payload);
	return answer ? { status: 200, body: answer } : { status: 202, body: null };
}

async function handleOne(ctx: McpContext, raw: unknown): Promise<JsonRpcResponse | null> {
	const message = raw as Partial<JsonRpcRequest> | null;
	if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
		if (message && typeof message === "object" && ("result" in message || "error" in message)) return null;
		return rpcError(null, -32600, "invalid request");
	}
	const id = message.id;
	if (id === undefined) return null;
	try {
		return { jsonrpc: "2.0", id, result: await dispatch(ctx, message.method, message.params) };
	} catch (error) {
		if (error instanceof RpcError) return rpcError(id, error.code, error.message);
		throw error;
	}
}

async function dispatch(ctx: McpContext, method: string, params: unknown): Promise<unknown> {
	switch (method) {
		case "initialize": {
			const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
			const protocolVersion = MCP_PROTOCOL_VERSIONS.find((version) => version === requested) ?? LATEST;
			return {
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "grokbot-kanban", title: "Grok Bot Kanban", version: "0.2.0" },
				instructions: MCP_INSTRUCTIONS,
			};
		}
		case "ping":
			return {};
		case "tools/list":
			return { tools: toolList() };
		case "tools/call":
			return callTool(ctx, params);
		case "resources/list":
			return { resources: [] };
		case "prompts/list":
			return { prompts: [] };
		default:
			throw new RpcError(-32601, `method not found: ${method}`);
	}
}

async function callTool(ctx: McpContext, params: unknown) {
	const { name, arguments: args } = (params ?? {}) as { name?: string; arguments?: unknown };
	if (!name || !(name in tools)) throw new RpcError(-32602, `unknown tool: ${String(name)}`);
	const tool = tools[name as ToolName];
	const parsed = tool.input.safeParse(args ?? {});
	if (!parsed.success) {
		return toolError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; "));
	}
	try {
		const result = await (tool.run as (ctx: McpContext, args: unknown) => Promise<unknown>)(ctx, parsed.data);
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
	} catch (error) {
		if (error instanceof BoardInputError || error instanceof NotFound) return toolError(error.message);
		if (error instanceof BadRequest || error instanceof z.ZodError) return toolError("invalid arguments");
		throw error;
	}
}

function compact(card: BotCardView, ctx: McpContext) {
	return {
		id: card.id,
		shortId: card.shortId,
		title: card.title,
		column: card.column,
		priority: card.priority,
		assignees: card.assignees.map((member) => member.name),
		createdBy: card.createdBy?.name ?? null,
		url: `${ctx.boardUrl}/?card=${card.id}`,
	};
}

function full(card: BotCardView, ctx: McpContext) {
	return { ...card, assignees: card.assignees.map((member) => member.name), createdBy: card.createdBy?.name ?? null, url: `${ctx.boardUrl}/?card=${card.id}` };
}

async function required<T>(value: Promise<T | null>): Promise<T> {
	const resolved = await value;
	if (resolved === null) throw new NotFound("card not found");
	return resolved;
}

class NotFound extends Error {}

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}

function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(message: string) {
	return { content: [{ type: "text", text: message }], isError: true };
}

/** Enough JSON Schema for the zod shapes used above. */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
	const def = schema._def as { typeName: string; description?: string };
	const withDescription = (out: Record<string, unknown>) =>
		schema.description ? { ...out, description: schema.description } : out;
	switch (def.typeName) {
		case "ZodObject": {
			const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
			const properties: Record<string, unknown> = {};
			const requiredKeys: string[] = [];
			for (const [key, value] of Object.entries(shape)) {
				properties[key] = jsonSchemaOf(value);
				if (!value.isOptional()) requiredKeys.push(key);
			}
			return withDescription({
				type: "object",
				properties,
				...(requiredKeys.length ? { required: requiredKeys } : {}),
				additionalProperties: false,
			});
		}
		case "ZodOptional":
		case "ZodDefault":
			return withDescription(jsonSchemaOf((schema._def as { innerType: z.ZodTypeAny }).innerType));
		case "ZodEffects":
			return withDescription(jsonSchemaOf((schema._def as { schema: z.ZodTypeAny }).schema));
		case "ZodNullable": {
			const inner = jsonSchemaOf((schema._def as { innerType: z.ZodTypeAny }).innerType);
			return withDescription({ anyOf: [inner, { type: "null" }] });
		}
		case "ZodString":
			return withDescription({ type: "string" });
		case "ZodNumber": {
			const checks = (schema._def as { checks: { kind: string }[] }).checks;
			return withDescription({ type: checks.some((check) => check.kind === "int") ? "integer" : "number" });
		}
		case "ZodBoolean":
			return withDescription({ type: "boolean" });
		case "ZodEnum":
			return withDescription({ type: "string", enum: (schema._def as { values: string[] }).values });
		case "ZodLiteral":
			return withDescription({ const: (schema._def as { value: unknown }).value });
		case "ZodArray":
			return withDescription({ type: "array", items: jsonSchemaOf((schema._def as { type: z.ZodTypeAny }).type) });
		case "ZodDiscriminatedUnion":
		case "ZodUnion": {
			const options = (schema._def as { options: z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny> }).options;
			const list = Array.isArray(options) ? options : [...options.values()];
			return withDescription({ anyOf: list.map(jsonSchemaOf) });
		}
		default:
			return withDescription({});
	}
}

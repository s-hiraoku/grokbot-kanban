import { isBot, isOwner, type Bot, type Owner } from "./auth";
import { botIdFor, cleanBotName, colorFor, type BotProfile, type BotProfilePatch } from "./bots";
import { DEFAULT_OWNER_AVATAR } from "./ownerAvatar";
import {
	COLUMNS,
	OWNER_MEMBER,
	RUNNABLE,
	columnOf,
	moved,
	nextRank,
	rankBetween,
	type Card,
	type CardContent,
	type CardId,
	type CardState,
	type Column,
	type ContentPatch,
	type Instant,
	type MemberId,
	type ParkColumn,
} from "./domain";
import type { Store } from "./store";
import { toBoardView, toBotCard, toBotView, type BoardView, type BotCardView, type BotView } from "./view";

export type NewCardInput = { externalId: string | null; content: CardContent };

export type BotProfileInput = { name: string; role: string; avatar?: string | null; color: string | null };

export type OwnerCommand =
	| { type: "create"; content: CardContent }
	| { type: "edit"; cardId: CardId; patch: ContentPatch }
	| { type: "move"; cardId: CardId; to: ParkColumn }
	/** Ask a Grok Bot to run the card. Without a bot, the first bot assigned to the card. */
	| { type: "run"; cardId: CardId; bot: string | null }
	| { type: "stop"; cardId: CardId }
	| { type: "drop"; cardId: CardId; column: Column; index: number }
	| { type: "saveBot"; id: string | null; profile: BotProfileInput }
	| { type: "deleteBot"; id: string }
	| { type: "deleteCard"; cardId: CardId }
	| { type: "setOwnerAvatar"; avatar: string | null };

export type CommandResult = {
	board: BoardView;
	notice: string | null;
	error: null | "not_found" | "busy" | "bad_request";
};

/** Thrown when a request names something the board cannot accept, such as an unknown assignee. */
export class BoardInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BoardInputError";
	}
}

export type OwnerBoard = {
	view(): Promise<BoardView>;
	execute(command: OwnerCommand): Promise<CommandResult>;
	/** The stored icon of a bot, for the image route. */
	avatar(botId: string): Promise<string | null>;
};

export type CardFilter = {
	column?: Column;
	/** A member ref. "me" is the calling bot. */
	assignee?: string;
	unassigned?: boolean;
	query?: string;
	limit?: number;
};

export type AssignChange = { add?: readonly string[]; remove?: readonly string[]; set?: readonly string[] };

export type BoardSummary = {
	/** Cards the owner asked the calling bot to run. */
	runRequests: BotCardView[];
	columns: { id: Column; label: string; count: number }[];
	mine: BotCardView[];
	unassignedInbox: number;
};

/**
 * What a bot may do. `actor` is the calling bot's name as it appears in its Grok Bot profile.
 * A new name joins the roster on first use. A bot may move a card to any column.
 */
export type BotBoard = {
	create(input: NewCardInput, actor?: string | null): Promise<{ card: BotCardView; created: boolean }>;
	patch(id: CardId, patch: ContentPatch, actor?: string | null): Promise<BotCardView | null>;
	get(id: CardId): Promise<BotCardView | null>;
	find(ref: string): Promise<BotCardView | null>;
	list(filter: CardFilter, actor?: string | null): Promise<BotCardView[]>;
	assign(ref: string, change: AssignChange, actor: string | null): Promise<BotCardView | null>;
	addNote(ref: string, text: string, actor: string | null): Promise<BotCardView | null>;
	move(ref: string, to: ParkColumn, reason: string | null, actor: string | null): Promise<BotCardView | null>;
	runRequests(actor: string): Promise<BotCardView[]>;
	startRun(ref: string, actor: string): Promise<BotCardView | null>;
	finishRun(ref: string, outcome: RunOutcome, summary: string, actor: string): Promise<BotCardView | null>;
	roster(): Promise<BotView[]>;
	identify(actor: string): Promise<BotView>;
	updateProfile(actor: string, patch: BotProfilePatch): Promise<BotView>;
	summary(actor: string | null): Promise<BoardSummary>;
};

/** How a bot ends a run: done moves the card to Done, review to In Review, blocked back to Todo. */
export type RunOutcome = "done" | "review" | "blocked";
const OUTCOME: Record<RunOutcome, { column: Column; label: string }> = {
	done: { column: "done", label: "finished" },
	review: { column: "inReview", label: "ready for review" },
	blocked: { column: "todo", label: "blocked" },
};

export type BoardDeps = {
	store: Store;
	now: () => Instant;
};

export type BoardHandle = {
	owner(cap: Owner): OwnerBoard;
	bot(cap: Bot): BotBoard;
};

type Applied = { kind: "written"; card: Card } | { kind: "unchanged"; card: Card } | { kind: "missing" } | { kind: "conflict" };

export function openBoard(deps: BoardDeps): BoardHandle {
	const ownerApi: OwnerBoard = {
		view: () => viewOf(deps),
		avatar: async (botId) => (await deps.store.bot(botId))?.avatar ?? (botId === OWNER_MEMBER ? DEFAULT_OWNER_AVATAR : null),
		execute: (command) => execute(deps, command),
	};
	return {
		owner(cap) {
			if (!isOwner(cap)) throw new Error("unauthorized");
			return ownerApi;
		},
		bot(cap) {
			if (!isBot(cap)) throw new Error("unauthorized");
			return botApi(deps);
		},
	};
}

function botApi(deps: BoardDeps): BotBoard {
	const { store, now } = deps;
	const identify = async (actor: string | null | undefined): Promise<BotProfile | null> => {
		if (!actor) return null;
		return touchBot(store, actor, now());
	};
	const updateCard = async (card: Card, patch: ContentPatch) => {
		const written = await store.patchContent(card.id, patch);
		if (!written) return null;
		return toBotCard(written, await store.bots());
	};
	return {
		async create(input, actor) {
			const bot = await identify(actor);
			const assignees = await resolveMembers(store, input.content.assignees, { actor: bot, now: now(), autoCreate: true });
			const ranks = (await store.all()).map((card) => card.rank);
			const { card, created } = await store.insert({
				externalId: input.externalId,
				content: { ...input.content, assignees },
				rank: nextRank(ranks),
				now: now(),
				createdBy: bot?.id ?? null,
			});
			return { card: toBotCard(card, await store.bots()), created };
		},
		async patch(id, patch, actor) {
			const bot = await identify(actor);
			const card = await store.get(id);
			if (!card) return null;
			const next = { ...patch };
			if (patch.assignees) next.assignees = await resolveMembers(store, patch.assignees, { actor: bot, now: now(), autoCreate: true });
			return updateCard(card, next);
		},
		async get(id) {
			const card = await store.get(id);
			return card ? toBotCard(card, await store.bots()) : null;
		},
		async find(ref) {
			const card = await findCard(store, ref);
			return card ? toBotCard(card, await store.bots()) : null;
		},
		async list(filter, actor) {
			const bot = await identify(actor);
			const roster = await store.bots();
			let cards = await store.all();
			if (filter.column) cards = cards.filter((card) => columnOf(card.state) === filter.column);
			if (filter.unassigned) cards = cards.filter((card) => card.content.assignees.length === 0);
			if (filter.assignee) {
				const [member] = await resolveMembers(store, [filter.assignee], { actor: bot, now: now(), autoCreate: false });
				cards = cards.filter((card) => member !== undefined && card.content.assignees.includes(member));
			}
			if (filter.query) {
				const needle = filter.query.toLowerCase();
				cards = cards.filter((card) =>
					[card.content.title, card.content.body, card.content.notes].some((text) => text.toLowerCase().includes(needle)),
				);
			}
			return cards.slice(0, filter.limit ?? 50).map((card) => toBotCard(card, roster));
		},
		async assign(ref, change, actor) {
			const bot = await identify(actor);
			const card = await findCard(store, ref);
			if (!card) return null;
			const options = { actor: bot, now: now(), autoCreate: true };
			let next: MemberId[];
			if (change.set) next = await resolveMembers(store, change.set, options);
			else {
				const add = await resolveMembers(store, change.add ?? (change.remove ? [] : ["me"]), options);
				const remove = new Set(await resolveMembers(store, change.remove ?? [], { ...options, autoCreate: false }));
				next = [...new Set([...card.content.assignees, ...add])].filter((id) => !remove.has(id));
			}
			return updateCard(card, { assignees: next.slice(0, 10) });
		},
		async addNote(ref, text, actor) {
			const bot = await identify(actor);
			const card = await findCard(store, ref);
			if (!card) return null;
			const stamp = new Date(now()).toISOString().slice(0, 16).replace("T", " ");
			const line = `[${stamp} ${bot?.name ?? "bot"}] ${text.trim()}`;
			const notes = card.content.notes ? `${card.content.notes}\n${line}` : line;
			if (notes.length > 20_000) throw new BoardInputError("notes would exceed 20000 characters");
			return updateCard(card, { notes });
		},
		async move(ref, to, reason, actor) {
			const bot = await identify(actor);
			const card = await findCard(store, ref);
			if (!card) return null;
			const from = columnOf(card.state);
			if (from === to) return toBotCard(card, await store.bots());
			const siblings = (await store.all()).filter((item) => item.id !== card.id && columnOf(item.state) === to);
			const applied = await move(deps, card.id, to);
			if (applied.kind === "conflict") throw new BoardInputError("The board is busy. Try again.");
			if (applied.kind === "missing") return null;
			await store.writeRank(card.id, rankBetween(siblings.at(-1)?.rank ?? null, null));
			const stamp = new Date(now()).toISOString().slice(0, 16).replace("T", " ");
			const line = `[${stamp} ${bot?.name ?? "bot"}] Moved from ${labelOf(from)} to ${labelOf(to)}${reason?.trim() ? `: ${reason.trim()}` : ""}`;
			const fresh = (await store.get(card.id)) ?? card;
			const notes = fresh.content.notes ? `${fresh.content.notes}\n${line}` : line;
			return updateCard(fresh, { notes: notes.slice(-20_000) });
		},
		async runRequests(actor) {
			const bot = await touchBot(store, actor, now());
			const roster = await store.bots();
			return (await store.all()).filter((card) => card.state.botRun?.bot === bot.id).map((card) => toBotCard(card, roster));
		},
		async startRun(ref, actor) {
			const bot = await touchBot(store, actor, now());
			const card = await findCard(store, ref);
			if (!card) return null;
			const run = card.state.botRun;
			if (run?.bot !== bot.id) throw new BoardInputError(`This card has no run for ${bot.name}. Call list_run_requests for yours.`);
			if (run.status === "working") return toBotCard(card, await store.bots());
			const at = now();
			const applied = await changeState(deps, card.id, (state) =>
				state.botRun?.bot === bot.id ? { ...state, column: "inProgress", botRun: { ...state.botRun, status: "working", startedAt: at } } : null,
			);
			if (applied.kind === "conflict") throw new BoardInputError("The board is busy. Try again.");
			if (applied.kind === "missing") return null;
			return noted(store, applied.card, bot.name, at, "Started the run");
		},
		async finishRun(ref, outcome, summary, actor) {
			const bot = await touchBot(store, actor, now());
			const card = await findCard(store, ref);
			if (!card) return null;
			if (card.state.botRun?.bot !== bot.id) throw new BoardInputError(`This card has no run for ${bot.name}. It may have been cancelled by the owner.`);
			const { column, label } = OUTCOME[outcome];
			const applied = await changeState(deps, card.id, (state) => (state.botRun?.bot === bot.id ? { ...state, column, botRun: null } : null));
			if (applied.kind === "conflict") throw new BoardInputError("The board is busy. Try again.");
			if (applied.kind === "missing") return null;
			return noted(store, applied.card, bot.name, now(), `Run ${label}: ${summary.trim()}`);
		},
		async roster() {
			const cards = await store.all();
			return (await rosterOf(store)).map((bot) => toBotView(bot, cards, now()));
		},
		async identify(actor) {
			const bot = await touchBot(store, actor, now());
			return toBotView(bot, await store.all(), now());
		},
		async updateProfile(actor, patch) {
			const bot = await touchBot(store, actor, now());
			const updated = await store.updateBot(bot.id, cleanProfilePatch(patch));
			if (!updated) throw new BoardInputError("bot disappeared");
			return toBotView(updated, await store.all(), now());
		},
		async summary(actor) {
			const bot = await identify(actor);
			const cards = await store.all();
			const roster = await store.bots();
			const view = toBoardView(cards, roster, now());
			return {
				runRequests: bot ? cards.filter((card) => card.state.botRun?.bot === bot.id).map((card) => toBotCard(card, roster)) : [],
				columns: view.columns.map((column) => ({ id: column.id, label: column.label, count: column.count })),
				mine: bot
					? cards.filter((card) => card.content.assignees.includes(bot.id)).map((card) => toBotCard(card, roster))
					: [],
				unassignedInbox: cards.filter((card) => columnOf(card.state) === "inbox" && card.content.assignees.length === 0).length,
			};
		},
	};
}

async function touchBot(store: Store, actor: string, at: Instant): Promise<BotProfile> {
	const existing = await lookupBot(store, actor);
	if (existing) return (await store.updateBot(existing.id, { lastSeenAt: at })) ?? existing;
	const name = cleanBotName(actor);
	if (!name) throw new BoardInputError("bot name is empty");
	return store.ensureBot({
		id: botIdFor(name),
		name,
		role: "",
		avatar: null,
		color: colorFor(name),
		createdAt: at,
		lastSeenAt: at,
	});
}

/** The bots, without the row that only holds the owner's uploaded icon. */
async function rosterOf(store: Store): Promise<BotProfile[]> {
	return (await store.bots()).filter((bot) => bot.id !== OWNER_MEMBER);
}

async function lookupBot(store: Store, ref: string): Promise<BotProfile | null> {
	const needle = cleanBotName(ref).toLowerCase();
	if (!needle) return null;
	const roster = await rosterOf(store);
	return (
		roster.find((bot) => bot.id === needle) ??
		roster.find((bot) => bot.name.toLowerCase() === needle) ??
		roster.find((bot) => bot.id === botIdFor(needle)) ??
		null
	);
}

async function resolveMembers(
	store: Store,
	refs: readonly string[],
	options: { actor: BotProfile | null; now: Instant; autoCreate: boolean },
): Promise<MemberId[]> {
	const out: MemberId[] = [];
	for (const raw of refs) {
		const ref = raw.trim();
		const lower = ref.toLowerCase();
		let id: MemberId | null = null;
		if (lower === OWNER_MEMBER || lower === "you" || lower === "human") id = OWNER_MEMBER;
		else if (lower === "me" || lower === "self") {
			if (!options.actor) throw new BoardInputError(`"${ref}" needs the calling bot's name`);
			id = options.actor.id;
		} else {
			const found = await lookupBot(store, ref);
			if (found) id = found.id;
			else if (options.autoCreate) id = (await touchBot(store, ref, options.now)).id;
			else throw new BoardInputError(`unknown assignee "${ref}"`);
		}
		if (!out.includes(id)) out.push(id);
	}
	return out;
}

async function findCard(store: Store, ref: string): Promise<Card | null> {
	const trimmed = ref.trim().toLowerCase().replace(/^#/, "");
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) return store.get(trimmed as CardId);
	if (!/^[0-9a-f]{4,32}$/.test(trimmed)) return null;
	const matches = (await store.all()).filter((card) => card.id.replaceAll("-", "").startsWith(trimmed));
	if (matches.length > 1) throw new BoardInputError(`card id "${ref}" matches ${matches.length} cards; use more characters`);
	return matches[0] ?? null;
}

function cleanProfilePatch(patch: BotProfilePatch): BotProfilePatch {
	const next: BotProfilePatch = {};
	if (patch.name !== undefined) {
		const name = cleanBotName(patch.name);
		if (!name) throw new BoardInputError("bot name is empty");
		next.name = name;
	}
	if (patch.role !== undefined) next.role = patch.role.slice(0, 200);
	if (patch.avatar !== undefined) next.avatar = patch.avatar ? patch.avatar.trim() : null;
	if (patch.color !== undefined) next.color = patch.color;
	return next;
}

async function execute(deps: BoardDeps, command: OwnerCommand): Promise<CommandResult> {
	try {
		return await executeChecked(deps, command);
	} catch (error) {
		if (error instanceof BoardInputError) return { board: await viewOf(deps), notice: error.message, error: "bad_request" };
		throw error;
	}
}

async function executeChecked(deps: BoardDeps, command: OwnerCommand): Promise<CommandResult> {
	const members = (refs: readonly string[]) =>
		resolveMembers(deps.store, refs, { actor: null, now: deps.now(), autoCreate: false });
	if ((command.type === "saveBot" && command.id === OWNER_MEMBER) || (command.type === "deleteBot" && command.id === OWNER_MEMBER)) {
		throw new BoardInputError("The owner is not a bot. Change your icon under Your icon.");
	}
	if (command.type === "saveBot") return saveBot(deps, command.id, command.profile);
	if (command.type === "setOwnerAvatar") {
		// The owner's icon lives in a reserved bots row, so no migration is needed. It never joins the roster.
		await deps.store.ensureBot({ id: OWNER_MEMBER, name: "You", role: "", avatar: null, color: "#f2b33d", createdAt: deps.now(), lastSeenAt: null });
		await deps.store.updateBot(OWNER_MEMBER, { avatar: command.avatar });
		return { board: await viewOf(deps), notice: command.avatar ? "Your icon is saved" : "Your icon is back to the default", error: null };
	}
	if (command.type === "deleteCard") {
		const card = await deps.store.get(command.cardId);
		if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
		await deps.store.deleteCard(card.id);
		return { board: await viewOf(deps), notice: "Card deleted", error: null };
	}
	if (command.type === "deleteBot") {
		const removed = await deps.store.deleteBot(command.id);
		if (!removed) return { board: await viewOf(deps), notice: null, error: "not_found" };
		for (const card of await deps.store.all()) {
			if (card.content.assignees.includes(command.id)) {
				await deps.store.patchContent(card.id, { assignees: card.content.assignees.filter((id) => id !== command.id) });
			}
		}
		return { board: await viewOf(deps), notice: "Bot removed", error: null };
	}
	if (command.type === "drop") return drop(deps, command);
	if (command.type === "run") return requestRun(deps, command.cardId, command.bot);
	if (command.type === "stop") return cancelRun(deps, command.cardId);
	if (command.type === "create") {
		const ranks = (await deps.store.all()).map((card) => card.rank);
		await deps.store.insert({
			externalId: null,
			content: { ...command.content, assignees: await members(command.content.assignees) },
			rank: nextRank(ranks),
			now: deps.now(),
			createdBy: OWNER_MEMBER,
		});
		return { board: await viewOf(deps), notice: "Card added", error: null };
	}
	if (command.type === "edit") {
		const patch = { ...command.patch };
		if (patch.assignees) patch.assignees = await members(patch.assignees);
		const card = await deps.store.patchContent(command.cardId, patch);
		if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
		return { board: await viewOf(deps), notice: null, error: null };
	}

	const applied = await move(deps, command.cardId, command.to);
	if (applied.kind === "missing") return { board: await viewOf(deps), notice: null, error: "not_found" };
	if (applied.kind === "conflict") return { board: await viewOf(deps), notice: null, error: "busy" };
	return { board: await viewOf(deps), notice: null, error: null };
}

async function saveBot(deps: BoardDeps, id: string | null, profile: BotProfileInput): Promise<CommandResult> {
	const name = cleanBotName(profile.name);
	if (!name) throw new BoardInputError("Give the bot a name.");
	const clash = await lookupBot(deps.store, name);
	if (clash && clash.id !== id) throw new BoardInputError(`A bot named ${clash.name} already exists.`);
	const patch = cleanProfilePatch({
		name,
		role: profile.role,
		...(profile.avatar === undefined ? {} : { avatar: profile.avatar || null }),
		color: profile.color ?? colorFor(name),
	});
	if (id) {
		const updated = await deps.store.updateBot(id, patch);
		if (!updated) return { board: await viewOf(deps), notice: null, error: "not_found" };
		return { board: await viewOf(deps), notice: "Bot saved", error: null };
	}
	await deps.store.ensureBot({
		id: botIdFor(name),
		name,
		role: patch.role ?? "",
		avatar: patch.avatar ?? null,
		color: patch.color ?? colorFor(name),
		createdAt: deps.now(),
		lastSeenAt: null,
	});
	return { board: await viewOf(deps), notice: "Bot added", error: null };
}

/** A card dropped on a column at a position. Same column only reorders. */
async function drop(deps: BoardDeps, command: Extract<OwnerCommand, { type: "drop" }>): Promise<CommandResult> {
	const card = await deps.store.get(command.cardId);
	if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
	const siblings = (await deps.store.all()).filter((item) => item.id !== card.id && columnOf(item.state) === command.column);
	const index = Math.min(command.index, siblings.length);
	const rank = rankBetween(siblings[index - 1]?.rank ?? null, siblings[index]?.rank ?? null);
	await deps.store.writeRank(card.id, rank);
	return executeChecked(deps, { type: "move", cardId: card.id, to: command.column });
}

/** Asks a bot to run the card. The bot joins the assignees if it is not one yet, and the card waits in Todo. */
async function requestRun(deps: BoardDeps, cardId: CardId, botId: string | null): Promise<CommandResult> {
	const card = await deps.store.get(cardId);
	if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
	const roster = await rosterOf(deps.store);
	const bot = botId ? roster.find((item) => item.id === botId) : roster.find((item) => card.content.assignees.includes(item.id));
	if (!bot) throw new BoardInputError(botId ? "That bot is not on the roster." : "Assign a Grok Bot to this card first, then run it.");
	const current = card.state.botRun;
	if (!current && !RUNNABLE.includes(card.state.column)) throw new BoardInputError("Run works on cards in Inbox, Todo, or In Progress. Move the card back to Todo to run it again.");
	if (current) {
		const holder = roster.find((item) => item.id === current.bot)?.name ?? current.bot;
		throw new BoardInputError(`${holder} already has a run for this card. Cancel it first.`);
	}
	const at = deps.now();
	const applied = await changeState(deps, card.id, (state) =>
		state.botRun ? null : { ...state, column: "inProgress", botRun: { bot: bot.id, status: "requested", requestedAt: at, startedAt: null } },
	);
	if (applied.kind === "missing") return { board: await viewOf(deps), notice: null, error: "not_found" };
	if (applied.kind !== "written") return { board: await viewOf(deps), notice: null, error: "busy" };
	if (!applied.card.content.assignees.includes(bot.id)) {
		await deps.store.patchContent(card.id, { assignees: [...applied.card.content.assignees, bot.id] });
	}
	await noted(deps.store, (await deps.store.get(card.id)) ?? applied.card, "You", at, `Asked ${bot.name} to run this card`);
	return { board: await viewOf(deps), notice: `Asked ${bot.name} to run this card. It starts on the Bot's next check.`, error: null };
}

/** Withdraws a run request. A bot already working is told on its next call that the run is gone. */
async function cancelRun(deps: BoardDeps, cardId: CardId): Promise<CommandResult> {
	const card = await deps.store.get(cardId);
	if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
	if (!card.state.botRun) return { board: await viewOf(deps), notice: null, error: null };
	// A request no Bot has picked up goes back to Todo; work already under way stays where it is.
	const applied = await changeState(deps, card.id, (state) =>
		state.botRun ? { ...state, column: state.botRun.status === "requested" ? "todo" : state.column, botRun: null } : null,
	);
	if (applied.kind === "missing") return { board: await viewOf(deps), notice: null, error: "not_found" };
	if (applied.kind === "conflict") return { board: await viewOf(deps), notice: null, error: "busy" };
	if (applied.kind === "written") await noted(deps.store, applied.card, "You", deps.now(), "Cancelled the run");
	return { board: await viewOf(deps), notice: "Run cancelled", error: null };
}

async function noted(store: Store, card: Card, author: string, at: Instant, text: string): Promise<BotCardView | null> {
	const stamp = new Date(at).toISOString().slice(0, 16).replace("T", " ");
	const line = `[${stamp} ${author}] ${text}`;
	const notes = card.content.notes ? `${card.content.notes}\n${line}` : line;
	const written = await store.patchContent(card.id, { notes: notes.slice(-20_000) });
	return written ? toBotCard(written, await store.bots()) : null;
}

/** Moving a card to Done or Won't Do also drops a run it was waiting on. */
async function move(deps: BoardDeps, cardId: CardId, to: Column): Promise<Applied> {
	return changeState(deps, cardId, (state) => {
		const next = moved(state, to);
		return next && (to === "done" || to === "wontDo") ? { ...next, botRun: null } : next;
	});
}

async function changeState(deps: BoardDeps, cardId: CardId, change: (state: CardState) => CardState | null): Promise<Applied> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const card = await deps.store.get(cardId);
		if (!card) return { kind: "missing" };
		const state = change(card.state);
		if (!state) return { kind: "unchanged", card };
		const written = await deps.store.writeState(card.id, card.version, { state, rank: card.rank });
		if (written === "conflict") continue;
		const fresh = await deps.store.get(cardId);
		if (!fresh) return { kind: "missing" };
		return { kind: "written", card: fresh };
	}
	return { kind: "conflict" };
}

async function viewOf(deps: BoardDeps): Promise<BoardView> {
	return toBoardView(await deps.store.all(), await deps.store.bots(), deps.now());
}

function labelOf(column: Column): string {
	return COLUMNS.find((item) => item.id === column)?.label ?? column;
}

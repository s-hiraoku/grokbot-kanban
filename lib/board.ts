import { isBot, isCron, isOwner, type Bot, type Cron, type Owner } from "./auth";
import { botIdFor, cleanBotName, colorFor, type BotProfile, type BotProfilePatch } from "./bots";
import { DEFAULT_OWNER_AVATAR } from "./ownerAvatar";
import type { CursorClient } from "./cursor";
import {
	COLUMNS,
	OWNER_MEMBER,
	START_TIMEOUT_MS,
	actionFor,
	columnOf,
	isSlotHolder,
	moveTargetsFor,
	nextRank,
	rankBetween,
	planPromotions,
	transition,
	type Card,
	type CardContent,
	type CardEvent,
	type CardId,
	type Column,
	type ContentPatch,
	type Instant,
	type LaunchId,
	type MemberId,
	type ParkColumn,
	type Rejection,
} from "./domain";
import { isParkColumn } from "./parse";
import type { Store } from "./store";
import {
	noticeFor,
	toBoardView,
	toBotCard,
	toBotView,
	type BoardView,
	type BotCardView,
	type BotView,
	type CommandOutcome,
} from "./view";

export type NewCardInput = { externalId: string | null; content: CardContent };

export type BotProfileInput = { name: string; role: string; avatar?: string | null; color: string | null };

export type OwnerCommand =
	| { type: "create"; content: CardContent }
	| { type: "edit"; cardId: CardId; patch: ContentPatch }
	| { type: "move"; cardId: CardId; to: ParkColumn }
	| { type: "run"; cardId: CardId }
	| { type: "stop"; cardId: CardId }
	| { type: "drop"; cardId: CardId; column: Column; index: number }
	| { type: "saveBot"; id: string | null; profile: BotProfileInput }
	| { type: "deleteBot"; id: string }
	| { type: "deleteCard"; cardId: CardId }
	| { type: "setOwnerAvatar"; avatar: string | null };

export type CommandResult = {
	board: BoardView;
	notice: string | null;
	/** "warning" when the command went through but did not do what the drop or click suggests. */
	tone?: "warning";
	error: null | "not_found" | "busy" | "bad_request";
};

/** Thrown when a request names something the board cannot accept, such as an unknown assignee. */
export class BoardInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BoardInputError";
	}
}
export type SyncReport = { observed: number; started: number; agents: BoardView["agents"] };

export type OwnerBoard = {
	view(): Promise<BoardView>;
	sync(): Promise<BoardView>;
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
	agents: BoardView["agents"];
	columns: { id: Column; label: string; count: number }[];
	mine: BotCardView[];
	unassignedInbox: number;
};

/**
 * What a bot may do. `actor` is the calling bot's name as it appears in its Grok Bot profile.
 * A new name joins the roster on first use. A bot may park a card in Inbox, Todo, Done, or Won't Do,
 * but never starts, stops, or dequeues a run: Todo from a bot only parks the card.
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
	roster(): Promise<BotView[]>;
	identify(actor: string): Promise<BotView>;
	updateProfile(actor: string, patch: BotProfilePatch): Promise<BotView>;
	summary(actor: string | null): Promise<BoardSummary>;
};

export type CronBoard = { sync(): Promise<SyncReport> };

export type BoardDeps = {
	store: Store;
	cursor: CursorClient;
	now: () => Instant;
	newId: () => string;
};

export type BoardHandle = {
	owner(cap: Owner): OwnerBoard;
	bot(cap: Bot): BotBoard;
	cron(cap: Cron): CronBoard;
};

type Applied =
	| { kind: "written"; card: Card }
	| { kind: "unchanged"; card: Card }
	| { kind: "stale"; card: Card }
	| { kind: "rejected"; reason: Rejection }
	| { kind: "slotTaken" }
	| { kind: "missing" }
	| { kind: "conflict" };

export function openBoard(deps: BoardDeps): BoardHandle {
	const ownerApi: OwnerBoard = {
		view: () => viewOf(deps),
		avatar: async (botId) => (await deps.store.bot(botId))?.avatar ?? (botId === OWNER_MEMBER ? DEFAULT_OWNER_AVATAR : null),
		sync: async () => {
			await syncOnce(deps);
			return viewOf(deps);
		},
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
		cron(cap) {
			if (!isCron(cap)) throw new Error("unauthorized");
			return {
				sync: async () => {
					const report = await syncOnce(deps);
					const board = await viewOf(deps);
					return { ...report, agents: board.agents };
				},
			};
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
			// Queued and running cards belong to the owner's run controls; moving one would dequeue or stop it.
			if (card.state.kind !== "idle" && card.state.kind !== "review") {
				throw new BoardInputError(`This card is ${card.state.kind === "queued" ? "waiting for an agent slot" : "running a Cursor agent"}. Only the owner can move it now.`);
			}
			if (!moveTargetsFor(card.state).includes(to)) throw new BoardInputError(`This card cannot move to ${labelOf(to)}.`);
			const siblings = (await store.all()).filter((item) => item.id !== card.id && columnOf(item.state) === to);
			const applied = await apply(deps, card.id, { type: "move", to });
			if (applied.kind === "conflict" || applied.kind === "slotTaken") throw new BoardInputError("The board is busy. Try again.");
			if (applied.kind === "rejected") throw new BoardInputError(noticeFor(applied) ?? "That move was refused.");
			if (applied.kind === "missing") return null;
			await store.writeRank(card.id, rankBetween(siblings.at(-1)?.rank ?? null, null));
			const stamp = new Date(now()).toISOString().slice(0, 16).replace("T", " ");
			const line = `[${stamp} ${bot?.name ?? "bot"}] Moved from ${labelOf(from)} to ${labelOf(to)}${reason?.trim() ? `: ${reason.trim()}` : ""}`;
			const fresh = (await store.get(card.id)) ?? card;
			const notes = fresh.content.notes ? `${fresh.content.notes}\n${line}` : line;
			return updateCard(fresh, { notes: notes.slice(-20_000) });
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
				agents: view.agents,
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
		// A queued or running card is tied to a slot and maybe a live agent. Stop it first.
		if (card.state.kind !== "idle" && card.state.kind !== "review") {
			throw new BoardInputError("Stop the agent before deleting this card.");
		}
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
	if (command.type === "create") {
		const ranks = (await deps.store.all()).map((card) => card.rank);
		await deps.store.insert({
			externalId: null,
			content: { ...command.content, assignees: await members(command.content.assignees) },
			rank: nextRank(ranks),
			now: deps.now(),
			createdBy: OWNER_MEMBER,
		});
		const board = await viewOf(deps);
		return {
			board,
			notice: noticeFor({ kind: "settled", command: "create", state: { kind: "idle", column: "inbox", last: null } }),
			error: null,
		};
	}
	if (command.type === "edit") {
		const patch = { ...command.patch };
		if (patch.assignees) patch.assignees = await members(patch.assignees);
		const card = await deps.store.patchContent(command.cardId, patch);
		if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
		return {
			board: await viewOf(deps),
			notice: noticeFor({ kind: "settled", command: "edit", state: card.state }),
			error: null,
		};
	}

	const event: CardEvent =
		command.type === "move"
			? { type: "move", to: command.to }
			: command.type === "run"
				? { type: "run" }
				: { type: "stop" };
	const applied = await apply(deps, command.cardId, event);
	if (applied.kind === "missing") return { board: await viewOf(deps), notice: null, error: "not_found" };
	if (applied.kind === "conflict") return { board: await viewOf(deps), notice: null, error: "busy" };
	if (applied.kind === "rejected") {
		return { board: await viewOf(deps), notice: noticeFor(applied), tone: "warning", error: null };
	}
	if (command.type === "run") await fillSlots(deps);
	if (command.type === "stop" && applied.kind === "written" && applied.card.state.kind === "stopping") {
		await settleStop(deps, applied.card);
	}
	if (command.type === "stop" && applied.kind === "written" && applied.card.state.kind === "idle") {
		await fillSlots(deps);
	}
	const fresh = await deps.store.get(command.cardId);
	const state = fresh?.state ?? (applied.kind === "written" || applied.kind === "unchanged" ? applied.card.state : null);
	const outcome: CommandOutcome = state
		? { kind: "settled", command: command.type, state }
		: { kind: "missing" };
	// A run that only queued, or whose launch is unconfirmed, did not start an agent yet.
	const tone = command.type === "run" && state && state.kind !== "running" ? ("warning" as const) : undefined;
	return { board: await viewOf(deps), notice: noticeFor(outcome), ...(tone ? { tone } : {}), error: state ? null : "not_found" };
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

/**
 * A card dropped on a column at a position. Same column only reorders. Todo or In Progress with a repo
 * starts a run, as the Run button does. Without a repo, Todo and In Progress park the card, so hand work
 * can be tracked there. In Review always parks. A queued card dropped on In Progress stays queued.
 */
async function drop(deps: BoardDeps, command: Extract<OwnerCommand, { type: "drop" }>): Promise<CommandResult> {
	const card = await deps.store.get(command.cardId);
	if (!card) return { board: await viewOf(deps), notice: null, error: "not_found" };
	const from = columnOf(card.state);
	const action = actionFor(card.state);
	const wantsRun = (command.column === "todo" || command.column === "inProgress") && from !== command.column;
	let event: CardEvent | null = null;
	let parkedNotice: string | null = null;
	if (from !== command.column) {
		if (wantsRun && action.command === "run" && action.enabled && card.content.repo) event = { type: "run" };
		else if (card.state.kind === "queued" && command.column === "inProgress") {
			return { board: await viewOf(deps), notice: "This card is already waiting for an agent slot.", tone: "warning", error: null };
		} else if (isParkColumn(command.column) && moveTargetsFor(card.state).includes(command.column)) {
			event = { type: "move", to: command.column };
			if (command.column === "todo" && !card.content.repo) parkedNotice = "Parked in Todo. Set a repo to run it.";
			if (command.column === "inProgress" && !card.content.repo) parkedNotice = "Moved to In Progress without an agent. Set a repo to run one.";
		} else {
			return { board: await viewOf(deps), notice: dropRefusal(card), tone: "warning", error: null };
		}
	}
	const all = await deps.store.all();
	const target = event?.type === "run" ? "todo" : command.column;
	const siblings = all.filter((item) => item.id !== card.id && columnOf(item.state) === target);
	const index = Math.min(command.index, siblings.length);
	const rank = rankBetween(siblings[index - 1]?.rank ?? null, siblings[index]?.rank ?? null);
	await deps.store.writeRank(card.id, rank);
	if (!event) return { board: await viewOf(deps), notice: null, error: null };
	const result = await executeChecked(deps, event.type === "run" ? { type: "run", cardId: card.id } : { type: "move", cardId: card.id, to: (event as { to: ParkColumn }).to });
	return parkedNotice && !result.error ? { ...result, notice: parkedNotice, tone: "warning" } : result;
}

function dropRefusal(card: Card): string {
	if (isSlotHolder(card.state)) return noticeFor({ kind: "rejected", reason: "activeRun" }) ?? "";
	if (!card.content.repo) return noticeFor({ kind: "rejected", reason: "noRepo" }) ?? "";
	return "This card is already queued for an agent.";
}

async function apply(deps: BoardDeps, cardId: CardId, event: CardEvent): Promise<Applied> {
	const ctx = { now: deps.now(), freshLaunchId: deps.newId() as LaunchId };
	for (let attempt = 0; attempt < 3; attempt++) {
		const card = await deps.store.get(cardId);
		if (!card) return { kind: "missing" };
		const result = transition(card, event, ctx);
		if (result.kind === "rejected") return result;
		if (result.kind === "stale") return { kind: "stale", card };
		if (result.kind === "unchanged") return { kind: "unchanged", card };
		const written = await deps.store.writeState(card.id, card.version, { state: result.state, rank: card.rank });
		if (written === "slotTaken") return { kind: "slotTaken" };
		if (written === "conflict") continue;
		const fresh = await deps.store.get(cardId);
		if (!fresh) return { kind: "missing" };
		return { kind: "written", card: fresh };
	}
	return { kind: "conflict" };
}

async function fillSlots(deps: BoardDeps): Promise<number> {
	let started = 0;
	const plan = planPromotions(await deps.store.all());
	for (const item of plan) {
		const claim = await apply(deps, item.cardId, {
			type: "slotClaimed",
			launchId: item.launchId,
			slot: item.slot,
		});
		if (claim.kind === "slotTaken") return started;
		if (claim.kind !== "written" || claim.card.state.kind !== "starting") continue;
		const request = claim.card.state.launch.request;
		const created = await deps.cursor.createAgent(request);
		if (created.kind === "created") {
			const attached = await apply(deps, item.cardId, {
				type: "agentCreated",
				launchId: item.launchId,
				agent: created.agent,
				cursorStatus: created.cursorStatus,
			});
			if (attached.kind === "stale") await deps.cursor.cancelRun(created.agent);
			else started += 1;
			continue;
		}
		if (created.kind === "rejected") {
			await apply(deps, item.cardId, {
				type: "launchFailed",
				launchId: item.launchId,
				message: created.message,
			});
		}
	}
	return started;
}

async function syncOnce(deps: BoardDeps): Promise<{ observed: number; started: number }> {
	let observed = 0;
	const live = (await deps.store.all()).filter((card) => card.state.kind === "queued" || isSlotHolder(card.state));
	for (const card of live) {
		if (card.state.kind === "starting" && deps.now() - card.state.claimedAt > START_TIMEOUT_MS) {
			await apply(deps, card.id, { type: "launchLost", launchId: card.state.launch.id });
			continue;
		}
		if (card.state.kind === "running" || card.state.kind === "stopping") {
			if (card.state.kind === "stopping") await deps.cursor.cancelRun(card.state.agent);
			const observation = await deps.cursor.getRun(card.state.agent);
			if (observation === "unreachable") continue;
			observed += 1;
			await apply(deps, card.id, { type: "runObserved", runId: card.state.agent.runId, observation });
		}
	}
	const started = await fillSlots(deps);
	return { observed, started };
}

async function settleStop(deps: BoardDeps, card: Card): Promise<void> {
	if (card.state.kind !== "stopping") return;
	await deps.cursor.cancelRun(card.state.agent);
	const observation = await deps.cursor.getRun(card.state.agent);
	if (observation === "unreachable") return;
	await apply(deps, card.id, { type: "runObserved", runId: card.state.agent.runId, observation });
	await fillSlots(deps);
}

async function viewOf(deps: BoardDeps): Promise<BoardView> {
	return toBoardView(await deps.store.all(), await deps.store.bots(), deps.now());
}

function labelOf(column: Column): string {
	return COLUMNS.find((item) => item.id === column)?.label ?? column;
}

import { isBot, isCron, isOwner, type Bot, type Cron, type Owner } from "./auth";
import type { CursorClient } from "./cursor";
import {
	START_TIMEOUT_MS,
	isSlotHolder,
	nextRank,
	planPromotions,
	transition,
	type Card,
	type CardContent,
	type CardEvent,
	type CardId,
	type ContentPatch,
	type Instant,
	type LaunchId,
	type ParkColumn,
	type Rejection,
} from "./domain";
import type { Store } from "./store";
import { noticeFor, toBoardView, toBotCard, type BoardView, type BotCardView, type CommandOutcome } from "./view";

export type NewCardInput = { externalId: string | null; content: CardContent };

export type OwnerCommand =
	| { type: "create"; content: CardContent }
	| { type: "edit"; cardId: CardId; patch: ContentPatch }
	| { type: "move"; cardId: CardId; to: ParkColumn }
	| { type: "run"; cardId: CardId }
	| { type: "stop"; cardId: CardId };

export type CommandResult = { board: BoardView; notice: string | null; error: null | "not_found" | "busy" };
export type SyncReport = { observed: number; started: number; agents: BoardView["agents"] };

export type OwnerBoard = {
	view(): Promise<BoardView>;
	sync(): Promise<BoardView>;
	execute(command: OwnerCommand): Promise<CommandResult>;
};

export type BotBoard = {
	create(input: NewCardInput): Promise<{ card: BotCardView; created: boolean }>;
	patch(id: CardId, patch: ContentPatch): Promise<BotCardView | null>;
	get(id: CardId): Promise<BotCardView | null>;
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
			return botApi(deps.store, deps.now);
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

function botApi(store: Store, now: () => Instant): BotBoard {
	return {
		async create(input) {
			const ranks = (await store.all()).map((card) => card.rank);
			const { card, created } = await store.insert({
				externalId: input.externalId,
				content: input.content,
				rank: nextRank(ranks),
				now: now(),
			});
			return { card: toBotCard(card), created };
		},
		async patch(id, patch) {
			const card = await store.patchContent(id, patch);
			return card ? toBotCard(card) : null;
		},
		async get(id) {
			const card = await store.get(id);
			return card ? toBotCard(card) : null;
		},
	};
}

async function execute(deps: BoardDeps, command: OwnerCommand): Promise<CommandResult> {
	if (command.type === "create") {
		const ranks = (await deps.store.all()).map((card) => card.rank);
		await deps.store.insert({
			externalId: null,
			content: command.content,
			rank: nextRank(ranks),
			now: deps.now(),
		});
		const board = await viewOf(deps);
		return {
			board,
			notice: noticeFor({ kind: "settled", command: "create", state: { kind: "idle", column: "inbox", last: null } }),
			error: null,
		};
	}
	if (command.type === "edit") {
		const card = await deps.store.patchContent(command.cardId, command.patch);
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
		return { board: await viewOf(deps), notice: noticeFor(applied), error: null };
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
	return { board: await viewOf(deps), notice: noticeFor(outcome), error: state ? null : "not_found" };
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
	return toBoardView(await deps.store.all(), deps.now());
}

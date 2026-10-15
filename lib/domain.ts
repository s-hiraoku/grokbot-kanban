declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type CardId = Brand<string, "CardId">;
export type LaunchId = Brand<string, "LaunchId">;
export type AgentId = Brand<string, "AgentId">;
export type RunId = Brand<string, "RunId">;
export type HttpsUrl = Brand<string, "HttpsUrl">;
export type Instant = Brand<number, "Instant">;

export const SLOTS = [1, 2, 3] as const;
export type Slot = (typeof SLOTS)[number];
export const MAX_RUNNING = SLOTS.length;

export const CREATE_TIMEOUT_MS = 25_000;
export const START_TIMEOUT_MS = 4 * 30_000;

export const LAUNCH_UNCONFIRMED_MESSAGE =
	"Launch did not confirm. Check Cursor before running again.";

export const QUEUE_HINT = `waiting for a free slot (${MAX_RUNNING} agents at most)`;
export const QUEUE_TOAST = `Agent queued · ${QUEUE_HINT}`;

export const COLUMNS = [
	{ id: "inbox", label: "Inbox", dot: "#8b919a" },
	{ id: "todo", label: "Todo", dot: "#e2b340" },
	{ id: "inProgress", label: "In Progress", dot: "#3dd68c" },
	{ id: "inReview", label: "In Review", dot: "#7aa2ff" },
	{ id: "done", label: "Done", dot: "#5fbea0" },
	{ id: "wontDo", label: "Won't Do", dot: "#e06c75" },
] as const;

export type Column = (typeof COLUMNS)[number]["id"];
/**
 * Any column a card can sit in without an agent. In Progress and In Review are included so work a
 * bot or the owner does by hand can be tracked there; a move never starts or stops a run.
 */
export type ParkColumn = Column;

export type Priority = "low" | "normal" | "high";
export type CardKind = { type: "text" } | { type: "voice"; seconds: number };
export type RepoRef = { url: HttpsUrl; startingRef: string };

export type CardContent = {
	title: string;
	body: string;
	notes: string;
	repo: RepoRef | null;
	source: string | null;
	originalLink: HttpsUrl | null;
	priority: Priority;
	kind: CardKind;
	screening: { by: string | null } | null;
	assignees: readonly MemberId[];
};

/** A bot id from the roster, or OWNER_MEMBER for the human owner. */
export type MemberId = string;
export const OWNER_MEMBER = "owner";

export type ContentPatch = {
	[K in keyof CardContent]?: CardContent[K];
};

export type AgentRequest = { promptText: string; repo: RepoRef };
export type Launch = { id: LaunchId; requestedAt: Instant; request: AgentRequest };
export type AgentRef = { agentId: AgentId; runId: RunId; url: HttpsUrl };

export type TerminalOutcome = "finished" | "error" | "cancelled" | "expired";

export type RunRecord =
	| {
			kind: "ended";
			launchId: LaunchId;
			endedAt: Instant;
			agent: AgentRef;
			outcome: TerminalOutcome;
			prUrl: HttpsUrl | null;
	  }
	| { kind: "launchFailed"; launchId: LaunchId; endedAt: Instant; message: string }
	| { kind: "launchLost"; launchId: LaunchId; endedAt: Instant };

export type ReviewedRun = Extract<RunRecord, { kind: "ended" }> & { prUrl: HttpsUrl };

export type CardState =
	| { kind: "idle"; column: ParkColumn; last: RunRecord | null }
	| { kind: "queued"; launch: Launch; last: RunRecord | null }
	| { kind: "starting"; launch: Launch; slot: Slot; claimedAt: Instant }
	| { kind: "running"; launch: Launch; slot: Slot; agent: AgentRef; cursorStatus: string }
	| { kind: "stopping"; launch: Launch; slot: Slot; agent: AgentRef; requestedAt: Instant }
	| { kind: "review"; run: ReviewedRun };

export type SlotHolder = Extract<CardState, { slot: Slot }>;

export type Card = {
	id: CardId;
	createdAt: Instant;
	createdBy: MemberId | null;
	rank: string;
	content: CardContent;
	state: CardState;
	version: number;
};

export type RunObservation =
	| { phase: "active"; cursorStatus: string }
	| { phase: "terminal"; outcome: TerminalOutcome; pullRequests: readonly PullRequest[] };

export type PullRequest = { repoKey: string; url: HttpsUrl };

export type OwnerEvent = { type: "move"; to: ParkColumn } | { type: "run" } | { type: "stop" };

export type SystemEvent =
	| { type: "slotClaimed"; launchId: LaunchId; slot: Slot }
	| { type: "agentCreated"; launchId: LaunchId; agent: AgentRef; cursorStatus: string }
	| { type: "launchFailed"; launchId: LaunchId; message: string }
	| { type: "launchLost"; launchId: LaunchId }
	| { type: "runObserved"; runId: RunId; observation: RunObservation };

export type CardEvent = OwnerEvent | SystemEvent;

export type TransitionContext = { now: Instant; freshLaunchId: LaunchId };

export type Rejection = "activeRun" | "noRepo" | "starting";

export type Transition =
	| { kind: "changed"; state: CardState }
	| { kind: "unchanged" }
	| { kind: "rejected"; reason: Rejection }
	| { kind: "stale" };

export function columnOf(state: CardState): Column {
	switch (state.kind) {
		case "idle":
			return state.column;
		case "queued":
			return "todo";
		case "starting":
		case "running":
		case "stopping":
			return "inProgress";
		case "review":
			return "inReview";
		default:
			return assertNever(state);
	}
}

export function isSlotHolder(state: CardState): state is SlotHolder {
	return state.kind === "starting" || state.kind === "running" || state.kind === "stopping";
}

export function transition(card: Card, event: CardEvent, ctx: TransitionContext): Transition {
	switch (event.type) {
		case "move":
			return applyMove(card.state, event.to);
		case "run":
			return applyRun(card, ctx);
		case "stop":
			return applyStop(card.state, ctx.now);
		case "slotClaimed":
			return applyClaim(card.state, event, ctx.now);
		case "agentCreated":
			return applyCreated(card.state, event);
		case "launchFailed":
			return applyLaunchFailed(card.state, event, ctx.now);
		case "launchLost":
			return applyLaunchLost(card.state, event, ctx.now);
		case "runObserved":
			return applyObserved(card.state, event, ctx.now);
		default:
			return assertNever(event);
	}
}

function applyMove(state: CardState, to: ParkColumn): Transition {
	if (isSlotHolder(state)) return { kind: "rejected", reason: "activeRun" };
	if (state.kind === "queued") {
		if (to === "todo") return { kind: "unchanged" };
		return { kind: "changed", state: { kind: "idle", column: to, last: state.last } };
	}
	if (state.kind === "idle") {
		if (state.column === to) return { kind: "unchanged" };
		return { kind: "changed", state: { kind: "idle", column: to, last: state.last } };
	}
	return {
		kind: "changed",
		state: { kind: "idle", column: to, last: state.run },
	};
}

function applyRun(card: Card, ctx: TransitionContext): Transition {
	const state = card.state;
	if (state.kind === "queued" || isSlotHolder(state)) return { kind: "unchanged" };
	const request = buildAgentRequest(card.content);
	if (!request) return { kind: "rejected", reason: "noRepo" };
	const last = state.kind === "review" ? state.run : state.last;
	return {
		kind: "changed",
		state: {
			kind: "queued",
			launch: { id: ctx.freshLaunchId, requestedAt: ctx.now, request },
			last,
		},
	};
}

function applyStop(state: CardState, now: Instant): Transition {
	switch (state.kind) {
		case "idle":
		case "review":
		case "stopping":
			return { kind: "unchanged" };
		case "queued":
			return { kind: "changed", state: { kind: "idle", column: "todo", last: state.last } };
		case "starting":
			return { kind: "rejected", reason: "starting" };
		case "running":
			return {
				kind: "changed",
				state: {
					kind: "stopping",
					launch: state.launch,
					slot: state.slot,
					agent: state.agent,
					requestedAt: now,
				},
			};
		default:
			return assertNever(state);
	}
}

function applyClaim(
	state: CardState,
	event: Extract<SystemEvent, { type: "slotClaimed" }>,
	now: Instant,
): Transition {
	if (state.kind !== "queued" || state.launch.id !== event.launchId) return { kind: "stale" };
	return {
		kind: "changed",
		state: {
			kind: "starting",
			launch: state.launch,
			slot: event.slot,
			claimedAt: now,
		},
	};
}

function applyCreated(
	state: CardState,
	event: Extract<SystemEvent, { type: "agentCreated" }>,
): Transition {
	if (state.kind !== "starting" || state.launch.id !== event.launchId) return { kind: "stale" };
	return {
		kind: "changed",
		state: {
			kind: "running",
			launch: state.launch,
			slot: state.slot,
			agent: event.agent,
			cursorStatus: event.cursorStatus,
		},
	};
}

function applyLaunchFailed(
	state: CardState,
	event: Extract<SystemEvent, { type: "launchFailed" }>,
	now: Instant,
): Transition {
	if (state.kind !== "starting" || state.launch.id !== event.launchId) return { kind: "stale" };
	return {
		kind: "changed",
		state: {
			kind: "idle",
			column: "todo",
			last: { kind: "launchFailed", launchId: event.launchId, endedAt: now, message: event.message },
		},
	};
}

function applyLaunchLost(
	state: CardState,
	event: Extract<SystemEvent, { type: "launchLost" }>,
	now: Instant,
): Transition {
	if (state.kind !== "starting" || state.launch.id !== event.launchId) return { kind: "stale" };
	return {
		kind: "changed",
		state: {
			kind: "idle",
			column: "todo",
			last: { kind: "launchLost", launchId: event.launchId, endedAt: now },
		},
	};
}

function applyObserved(
	state: CardState,
	event: Extract<SystemEvent, { type: "runObserved" }>,
	now: Instant,
): Transition {
	if (state.kind !== "running" && state.kind !== "stopping") return { kind: "stale" };
	if (state.agent.runId !== event.runId) return { kind: "stale" };
	const observation = event.observation;
	if (observation.phase === "active") {
		if (state.kind === "stopping") return { kind: "unchanged" };
		if (state.cursorStatus === observation.cursorStatus) return { kind: "unchanged" };
		return {
			kind: "changed",
			state: { ...state, cursorStatus: observation.cursorStatus },
		};
	}
	const prUrl = pickPullRequest(observation.pullRequests, state.launch.request.repo);
	const ended: RunRecord = {
		kind: "ended",
		launchId: state.launch.id,
		endedAt: now,
		agent: state.agent,
		outcome: observation.outcome,
		prUrl,
	};
	if (prUrl) {
		return { kind: "changed", state: { kind: "review", run: { ...ended, kind: "ended", prUrl } } };
	}
	return { kind: "changed", state: { kind: "idle", column: "todo", last: ended } };
}

export function buildAgentRequest(content: CardContent): AgentRequest | null {
	if (!content.repo) return null;
	const parts = [`# ${content.title}`];
	if (content.body) parts.push(content.body);
	if (content.notes) parts.push(`## Notes\n${content.notes}`);
	if (content.originalLink) parts.push(`Original: ${content.originalLink}`);
	if (content.source) parts.push(`Source: ${content.source}`);
	return { promptText: parts.join("\n\n"), repo: content.repo };
}

export function planPromotions(
	cards: readonly Card[],
): readonly { cardId: CardId; launchId: LaunchId; slot: Slot }[] {
	const used = new Set<Slot>();
	for (const card of cards) {
		if (isSlotHolder(card.state)) used.add(card.state.slot);
	}
	const free = SLOTS.filter((slot) => !used.has(slot));
	const queued = cards
		.filter((card): card is Card & { state: Extract<CardState, { kind: "queued" }> } => card.state.kind === "queued")
		.sort((a, b) => Number(a.rank) - Number(b.rank) || a.id.localeCompare(b.id));
	const planned: { cardId: CardId; launchId: LaunchId; slot: Slot }[] = [];
	for (let i = 0; i < queued.length && i < free.length; i++) {
		const slot = free[i];
		if (slot === undefined) break;
		planned.push({ cardId: queued[i].id, launchId: queued[i].state.launch.id, slot });
	}
	return planned;
}

export function pickPullRequest(prs: readonly PullRequest[], repo: RepoRef): HttpsUrl | null {
	const want = repoKey(repo.url);
	const match = prs.find((pr) => pr.repoKey === want);
	return (match ?? prs[0])?.url ?? null;
}

export function repoKey(url: string): string {
	return url
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
}

/** A rank that sorts between two neighbours. Either side may be missing. */
export function rankBetween(before: string | null, after: string | null): string {
	const low = before === null ? null : Number(before);
	const high = after === null ? null : Number(after);
	let value: number;
	if (low === null && high === null) value = 1000;
	else if (low === null) value = (high as number) > 1 ? (high as number) / 2 : (high as number) - 1000;
	else if (high === null) value = low + 1000;
	else value = (low + high) / 2;
	return formatRank(value);
}

function formatRank(value: number): string {
	const fixed = Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "");
	return value < 0 ? fixed : fixed.padStart(16, "0");
}

export function nextRank(ranks: readonly string[]): string {
	const nums = ranks.map(Number).filter((n) => Number.isFinite(n));
	const max = nums.length ? Math.max(...nums) : 0;
	return String(max + 1000).padStart(16, "0");
}

export type CardAction = { label: "Run" | "Re-run" | "Stop"; command: "run" | "stop"; enabled: boolean };

export function actionFor(state: CardState): CardAction {
	switch (state.kind) {
		case "idle":
			return state.last
				? { label: "Re-run", command: "run", enabled: true }
				: { label: "Run", command: "run", enabled: true };
		case "review":
			return { label: "Re-run", command: "run", enabled: true };
		case "queued":
		case "running":
			return { label: "Stop", command: "stop", enabled: true };
		case "starting":
		case "stopping":
			return { label: "Stop", command: "stop", enabled: false };
		default:
			return assertNever(state);
	}
}

export function moveTargetsFor(state: CardState): readonly ParkColumn[] {
	if (isSlotHolder(state)) return [];
	return COLUMNS.map((column) => column.id);
}

export function agentHref(state: CardState): string | null {
	if (state.kind === "running" || state.kind === "stopping") return state.agent.url;
	if (state.kind === "review") return state.run.agent.url;
	if ((state.kind === "idle" || state.kind === "queued") && state.last?.kind === "ended") {
		return state.last.agent.url;
	}
	return null;
}

export function prHref(state: CardState): string | null {
	if (state.kind === "review") return state.run.prUrl;
	if ((state.kind === "idle" || state.kind === "queued") && state.last?.kind === "ended") {
		return state.last.prUrl;
	}
	return null;
}

export function failureMessage(state: CardState): string | null {
	const last = state.kind === "idle" || state.kind === "queued" ? state.last : null;
	if (!last) return null;
	if (last.kind === "launchFailed") return last.message;
	if (last.kind === "launchLost") return LAUNCH_UNCONFIRMED_MESSAGE;
	if (last.kind === "ended" && last.outcome === "error") return "The run failed.";
	if (last.kind === "ended" && last.outcome === "expired") return "The run expired.";
	return null;
}

function assertNever(value: never): never {
	throw new Error(`unhandled ${JSON.stringify(value)}`);
}

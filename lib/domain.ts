declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type CardId = Brand<string, "CardId">;
export type LaunchId = Brand<string, "LaunchId">;
export type AgentId = Brand<string, "AgentId">;
export type RunId = Brand<string, "RunId">;
export type HttpsUrl = Brand<string, "HttpsUrl">;
export type Instant = Brand<number, "Instant">;

export const COLUMNS = [
	{ id: "inbox", label: "Inbox", dot: "#8b919a" },
	{ id: "todo", label: "Todo", dot: "#e2b340" },
	{ id: "inProgress", label: "In Progress", dot: "#3dd68c" },
	{ id: "inReview", label: "In Review", dot: "#7aa2ff" },
	{ id: "done", label: "Done", dot: "#5fbea0" },
	{ id: "wontDo", label: "Won't Do", dot: "#e06c75" },
] as const;

export type Column = (typeof COLUMNS)[number]["id"];
/** A column a card is moved to. Every column takes any card. */
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

export type AgentRef = { agentId: AgentId; runId: RunId; url: HttpsUrl };

/** The card's last Cursor agent run that ended, so its agent and pull request links still open. */
export type PastRun = {
	kind: "ended";
	launchId: LaunchId;
	endedAt: Instant;
	agent: AgentRef;
	outcome: "finished" | "error" | "cancelled" | "expired";
	prUrl: HttpsUrl | null;
};

/**
 * A Run the owner asked a Grok Bot to do. The board cannot wake a Bot, so the Bot finds requests on its
 * own schedule (a routine that calls list_run_requests), marks the run working, and reports back.
 */
/**
 * Columns a Bot run starts from. Pressing Run moves the card straight to In Progress; a card already
 * there with no run going (cancelled, or moved by hand) offers Re-run instead.
 */
export const RUNNABLE: readonly Column[] = ["inbox", "todo", "inProgress"];

/**
 * The Bot that Run hands a card to without asking: the first Bot among the card's assignees, in assignee
 * order. null means nobody on the card is a Bot, so Run asks which one to use.
 */
export function runnerOf<T extends { id: string }>(assignees: readonly string[], bots: readonly T[]): T | null {
	for (const id of assignees) {
		const bot = bots.find((item) => item.id === id);
		if (bot) return bot;
	}
	return null;
}

export type BotRun = {
	bot: MemberId;
	status: "requested" | "working";
	requestedAt: Instant;
	startedAt: Instant | null;
	/** A coordinating Bot that picked up the request and passed it on to `bot`. */
	passedOn: { by: MemberId; at: Instant } | null;
};

/**
 * A Cursor cloud agent working on the card's repository. launching until Cursor confirms the agent, then
 * running until the board sees the run end. The owner starts one from Run, or a Bot hands the card over.
 */
export type CursorRun = {
	launchId: LaunchId;
	status: "launching" | "running";
	agent: AgentRef | null;
	/** Who handed the card to Cursor: the owner or a Bot. */
	by: MemberId;
	/** The column the card left, where it goes back if Cursor refuses the launch. */
	from: Column;
	startedAt: Instant;
	/** When the board last asked Cursor how the run is going. */
	checkedAt: Instant;
};

/** How long a launch may stay unconfirmed before the board gives up on it. */
export const LAUNCH_TIMEOUT_MS = 2 * 60_000;
/** How often the board asks Cursor about a run while someone is looking. */
export const CHECK_EVERY_MS = 20_000;
export const CREATE_TIMEOUT_MS = 15_000;
export const CHECK_TIMEOUT_MS = 8_000;

/**
 * Where a card sits, and the run it is waiting on, if any: a Grok Bot's or a Cursor agent's, never both.
 * The stored shape is still the idle state earlier versions wrote; they ignore the extra run fields.
 */
export type CardState = { kind: "idle"; column: Column; last: PastRun | null; botRun: BotRun | null; cursorRun: CursorRun | null };

/** What a Cursor agent is told: the card itself, its notes so far, and what the hand-off adds. */
export function cursorPrompt(content: CardContent, handoff: { by: string; instructions: string | null }): string {
	const parts = [`# ${content.title}`];
	if (content.body.trim()) parts.push(content.body.trim());
	if (content.notes.trim()) parts.push(`## Notes on the card so far\n${content.notes.trim().slice(-6000)}`);
	if (handoff.instructions?.trim()) parts.push(`## From ${handoff.by}\n${handoff.instructions.trim()}`);
	parts.push("Make the change this card asks for in the repository, and open a pull request with it. If the card does not ask for a code change, explain why in the pull request description instead.");
	return parts.join("\n\n");
}

/** A repository URL without its scheme or .git, as Cursor reports it in git.branches[].repoUrl. */
export function repoKey(url: string): string {
	return url.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

export type Card = {
	id: CardId;
	createdAt: Instant;
	createdBy: MemberId | null;
	rank: string;
	content: CardContent;
	state: CardState;
	version: number;
};

export function columnOf(state: CardState): Column {
	return state.column;
}

/** The state after moving to a column, or null when the card is already there. */
export function moved(state: CardState, to: Column): CardState | null {
	if (state.column === to) return null;
	return { ...state, column: to };
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

export function agentHref(state: CardState): string | null {
	return state.cursorRun?.agent?.url ?? state.last?.agent.url ?? null;
}

export function prHref(state: CardState): string | null {
	return state.last?.prUrl ?? null;
}

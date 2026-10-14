import type { BotProfile } from "./bots";
import {
	COLUMNS,
	OWNER_MEMBER,
	LAUNCH_UNCONFIRMED_MESSAGE,
	MAX_RUNNING,
	QUEUE_HINT,
	QUEUE_TOAST,
	actionFor,
	agentHref,
	columnOf,
	failureMessage,
	isSlotHolder,
	moveTargetsFor,
	prHref,
	type Card,
	type CardId,
	type CardState,
	type Column,
	type MemberId,
	type ParkColumn,
	type Rejection,
} from "./domain";

export type BoardView = {
	agents: { running: number; queued: number; capacity: number };
	columns: readonly ColumnView[];
	bots: readonly BotView[];
};

export type MemberView = {
	id: MemberId;
	name: string;
	kind: "bot" | "owner" | "unknown";
	avatar: string | null;
	color: string;
	initials: string;
};

export type BotView = MemberView & {
	kind: "bot";
	role: string;
	assigned: number;
	created: number;
	lastSeen: string | null;
};

export type ColumnView = {
	id: Column;
	label: string;
	dot: string;
	count: number;
	cards: readonly CardView[];
};

export type Pill = { label: "queued" | "running"; tone: "yellow" | "spinner" };

export type CardView = {
	id: CardId;
	shortId: string;
	column: Column;
	age: string;
	title: string;
	body: string;
	notes: string;
	kindLabel: string;
	priority: string;
	source: string | null;
	repoLabel: string | null;
	pill: Pill | null;
	hint: string | null;
	screening: string | null;
	screened: boolean;
	reviewer: string | null;
	createdBy: MemberView | null;
	assignees: readonly MemberView[];
	repo: { url: string; startingRef: string } | null;
	originalLink: string | null;
	kind: { type: "text" } | { type: "voice"; seconds: number };
	links: { character: string | null; agent: string | null; pr: string | null };
	failure: string | null;
	action: { label: "Run" | "Re-run" | "Stop"; command: "run" | "stop"; enabled: boolean };
	moveTargets: readonly ParkColumn[];
};

export type BotCardView = {
	id: CardId;
	shortId: string;
	column: Column;
	status: CardState["kind"];
	createdAt: string;
	title: string;
	body: string;
	notes: string;
	repo: { url: string; startingRef: string } | null;
	source: string | null;
	originalLink: string | null;
	priority: string;
	kind: { type: "text" } | { type: "voice"; seconds: number };
	screening: { by: string | null } | null;
	assignees: { id: MemberId; name: string }[];
	createdBy: { id: MemberId; name: string } | null;
	agentUrl: string | null;
	prUrl: string | null;
};

export type CommandOutcome =
	| { kind: "rejected"; reason: Rejection }
	| { kind: "unchanged"; state: CardState }
	| { kind: "settled"; command: "move" | "run" | "stop" | "create" | "edit" | "drop"; state: CardState }
	| { kind: "missing" };

export function toBoardView(cards: readonly Card[], bots: readonly BotProfile[], now: number): BoardView {
	const running = cards.filter((card) => isSlotHolder(card.state)).length;
	const queued = cards.filter((card) => card.state.kind === "queued").length;
	const columns = COLUMNS.map((column) => {
		const inColumn = cards
			.filter((card) => columnOf(card.state) === column.id)
			.sort((a, b) => Number(a.rank) - Number(b.rank) || a.id.localeCompare(b.id));
		return {
			id: column.id,
			label: column.label,
			dot: column.dot,
			count: inColumn.length,
			cards: inColumn.map((card) => toCardView(card, bots, now)),
		};
	});
	return {
		agents: { running, queued, capacity: MAX_RUNNING },
		columns,
		bots: bots.map((bot) => toBotView(bot, cards, now)),
	};
}

export function toBotView(bot: BotProfile, cards: readonly Card[], now: number): BotView {
	return {
		...memberOf(bot.id, [bot]),
		kind: "bot",
		role: bot.role,
		assigned: cards.filter((card) => card.content.assignees.includes(bot.id)).length,
		created: cards.filter((card) => card.createdBy === bot.id).length,
		lastSeen: bot.lastSeenAt === null ? null : ageLabel(bot.lastSeenAt, now),
	};
}

export function memberOf(id: MemberId, bots: readonly BotProfile[]): MemberView {
	if (id === OWNER_MEMBER) {
		return { id, name: "You", kind: "owner", avatar: null, color: "#d7c4a3", initials: "You" };
	}
	const bot = bots.find((item) => item.id === id);
	if (!bot) return { id, name: id, kind: "unknown", avatar: null, color: "#5b616b", initials: initialsOf(id) };
	return { id, name: bot.name, kind: "bot", avatar: bot.avatar, color: bot.color, initials: initialsOf(bot.name) };
}

export function initialsOf(name: string): string {
	const words = name.trim().split(/[\s_-]+/).filter(Boolean);
	if (words.length >= 2 && /^[A-Za-z0-9]/.test(words[0] ?? "") && /^[A-Za-z0-9]/.test(words[1] ?? "")) {
		return `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`.toUpperCase();
	}
	const chars = Array.from(name.trim());
	if (chars.length === 0) return "?";
	return /^[A-Za-z0-9]/.test(chars[0] ?? "") ? chars.slice(0, 2).join("").toUpperCase() : (chars[0] ?? "?");
}

export function toCardView(card: Card, bots: readonly BotProfile[], now: number): CardView {
	const column = columnOf(card.state);
	const screening = screeningLabel(card.content.screening);
	return {
		id: card.id,
		shortId: card.id.replaceAll("-", "").slice(0, 6),
		column,
		age: ageLabel(card.createdAt, now),
		title: card.content.title,
		body: card.content.body,
		notes: card.content.notes,
		kindLabel: card.content.kind.type === "text" ? "text" : `voice ${card.content.kind.seconds}s`,
		priority: card.content.priority,
		source: card.content.source,
		repoLabel: repoLabel(card.content.repo?.url ?? null),
		pill: pillFor(card.state),
		hint: card.state.kind === "queued" ? QUEUE_HINT : null,
		screening,
		screened: card.content.screening !== null,
		reviewer: card.content.screening?.by ?? null,
		createdBy: card.createdBy ? memberOf(card.createdBy, bots) : null,
		assignees: card.content.assignees.map((id) => memberOf(id, bots)),
		repo: card.content.repo ? { url: card.content.repo.url, startingRef: card.content.repo.startingRef } : null,
		originalLink: card.content.originalLink,
		kind: card.content.kind,
		links: {
			character: card.content.originalLink,
			agent: agentHref(card.state),
			pr: prHref(card.state),
		},
		failure: failureMessage(card.state),
		action: actionFor(card.state),
		moveTargets: moveTargetsFor(card.state),
	};
}

export function toBotCard(card: Card, bots: readonly BotProfile[]): BotCardView {
	return {
		id: card.id,
		shortId: card.id.replaceAll("-", "").slice(0, 6),
		column: columnOf(card.state),
		status: card.state.kind,
		createdAt: new Date(card.createdAt).toISOString(),
		title: card.content.title,
		body: card.content.body,
		notes: card.content.notes,
		repo: card.content.repo
			? { url: card.content.repo.url, startingRef: card.content.repo.startingRef }
			: null,
		source: card.content.source,
		originalLink: card.content.originalLink,
		priority: card.content.priority,
		kind: card.content.kind,
		screening: card.content.screening,
		assignees: card.content.assignees.map((id) => ({ id, name: memberOf(id, bots).name })),
		createdBy: card.createdBy ? { id: card.createdBy, name: memberOf(card.createdBy, bots).name } : null,
		agentUrl: agentHref(card.state),
		prUrl: prHref(card.state),
	};
}

export function noticeFor(outcome: CommandOutcome): string | null {
	if (outcome.kind === "missing") return null;
	if (outcome.kind === "rejected") {
		if (outcome.reason === "noRepo") return "Set a repo before running.";
		if (outcome.reason === "activeRun") return "Stop the agent before moving this card.";
		return "The agent is starting. Try again in a moment.";
	}
	const state = outcome.state;
	if (outcome.kind === "settled" && outcome.command === "run") {
		if (state.kind === "queued") return QUEUE_TOAST;
		if (state.kind === "starting") return LAUNCH_UNCONFIRMED_MESSAGE;
		if (state.kind === "running") return "Agent started";
	}
	if (outcome.kind === "settled" && outcome.command === "stop" && state.kind === "idle") {
		return "Removed from the queue.";
	}
	if (outcome.kind === "settled" && outcome.command === "stop" && state.kind === "stopping") {
		return "Stopping agent";
	}
	if (outcome.kind === "settled" && outcome.command === "create") return "Card added";
	return null;
}

function pillFor(state: CardState): Pill | null {
	if (state.kind === "queued") return { label: "queued", tone: "yellow" };
	if (state.kind === "starting" || state.kind === "running" || state.kind === "stopping") {
		return { label: "running", tone: "spinner" };
	}
	return null;
}

function screeningLabel(screening: { by: string | null } | null): string | null {
	if (!screening) return null;
	if (screening.by === "grok") return "screened · grok";
	if (screening.by) return `screened · ${screening.by}`;
	return "screened";
}

function repoLabel(url: string | null): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split("/").filter(Boolean);
		if (parts.length >= 2) return `${parts[0]}/${parts[1]?.replace(/\.git$/, "")}`;
		return parsed.host;
	} catch {
		return url;
	}
}

export function ageLabel(createdAt: number, now: number): string {
	const sec = Math.max(0, Math.floor((now - createdAt) / 1000));
	if (sec < 45) return "just now";
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 48) return `${hr}h`;
	return `${Math.floor(hr / 24)}d`;
}

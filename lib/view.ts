import type { BotProfile } from "./bots";
import { COLUMNS, OWNER_MEMBER, agentHref, columnOf, prHref, type Card, type CardId, type Column, type MemberId } from "./domain";

export type BoardView = {
	columns: readonly ColumnView[];
	bots: readonly BotView[];
	owner: { avatar: string };
	/** Whether Run can hand cards to a Cursor cloud agent (CURSOR_API_KEY is set). */
	cursor: { enabled: boolean };
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

export type CardView = {
	id: CardId;
	shortId: string;
	column: Column;
	/** How long ago it was filed, from ageLabel. */
	age: string;
	/** When it was filed, ISO 8601, for the date and the exact time on hover. */
	createdAt: string;
	title: string;
	body: string;
	notes: string;
	kindLabel: string;
	priority: string;
	source: string | null;
	repoLabel: string | null;
	screening: string | null;
	screened: boolean;
	reviewer: string | null;
	createdBy: MemberView | null;
	assignees: readonly MemberView[];
	repo: { url: string; startingRef: string } | null;
	originalLink: string | null;
	kind: { type: "text" } | { type: "voice"; seconds: number };
	links: { character: string | null; agent: string | null; pr: string | null };
	/** The Grok Bot run this card waits on: requested until the bot picks it up, then working. */
	run: { bot: MemberView; status: "requested" | "working"; since: string; passedOn: { by: MemberView; since: string } | null } | null;
	/** The Cursor agent working on the card: launching until Cursor confirms it, then running. */
	cursor: { status: "launching" | "running"; agentUrl: string | null; by: MemberView; since: string } | null;
};

export type BotCardView = {
	id: CardId;
	shortId: string;
	column: Column;
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
	run: { bot: string; status: "requested" | "working"; requestedAt: string; startedAt: string | null; passedOnBy: string | null; passedOnAt: string | null } | null;
	cursor: { status: "launching" | "running"; agentUrl: string | null; by: string; startedAt: string } | null;
};

export function toBoardView(cards: readonly Card[], bots: readonly BotProfile[], now: number, options: { cursorEnabled: boolean } = { cursorEnabled: false }): BoardView {
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
		columns,
		bots: bots.filter((bot) => bot.id !== OWNER_MEMBER).map((bot) => toBotView(bot, cards, now)),
		owner: { avatar: ownerAvatarUrl(bots) },
		cursor: { enabled: options.cursorEnabled },
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
		return { id, name: "You", kind: "owner", avatar: ownerAvatarUrl(bots), color: "#d7c4a3", initials: "You" };
	}
	const bot = bots.find((item) => item.id === id);
	if (!bot) return { id, name: id, kind: "unknown", avatar: null, color: "#5b616b", initials: initialsOf(id) };
	return { id, name: bot.name, kind: "bot", avatar: avatarUrl(bot), color: bot.color, initials: initialsOf(bot.name) };
}

/** The owner's uploaded icon, or the bundled default. Both are served from /api/avatar/owner. */
export function ownerAvatarUrl(bots: readonly BotProfile[]): string {
	const row = bots.find((bot) => bot.id === OWNER_MEMBER);
	return row?.avatar ? (avatarUrl(row) ?? "/api/avatar/owner?v=default") : "/api/avatar/owner?v=default";
}

/** An uploaded image is served from its own route, so a poll does not resend it once per card. */
export function avatarUrl(bot: Pick<BotProfile, "id" | "avatar">): string | null {
	if (!bot.avatar?.startsWith("data:")) return bot.avatar;
	let hash = 2166136261;
	for (let index = 0; index < bot.avatar.length; index += 7) hash = Math.imul(hash ^ bot.avatar.charCodeAt(index), 16777619);
	return `/api/avatar/${encodeURIComponent(bot.id)}?v=${(hash >>> 0).toString(36)}-${bot.avatar.length}`;
}

export function initialsOf(name: string): string {
	const words = name.trim().split(/[\s_-]+/).filter(Boolean);
	const last = words[words.length - 1] ?? "";
	if (words.length >= 2 && /^[A-Za-z0-9]/.test(words[0] ?? "") && /^[A-Za-z0-9]/.test(last)) {
		// "Chief of Staff" reads as CS, not CO.
		return `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(last)[0] ?? ""}`.toUpperCase();
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
		createdAt: new Date(card.createdAt).toISOString(),
		title: card.content.title,
		body: card.content.body,
		notes: card.content.notes,
		kindLabel: card.content.kind.type === "text" ? "text" : `voice ${card.content.kind.seconds}s`,
		priority: card.content.priority,
		source: card.content.source,
		repoLabel: repoLabel(card.content.repo?.url ?? null),
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
		run: card.state.botRun
			? {
					bot: memberOf(card.state.botRun.bot, bots),
					status: card.state.botRun.status,
					since: ageLabel(card.state.botRun.startedAt ?? card.state.botRun.requestedAt, now),
					passedOn: card.state.botRun.passedOn ? { by: memberOf(card.state.botRun.passedOn.by, bots), since: ageLabel(card.state.botRun.passedOn.at, now) } : null,
				}
			: null,
		cursor: card.state.cursorRun
			? {
					status: card.state.cursorRun.status,
					agentUrl: card.state.cursorRun.agent?.url ?? null,
					by: memberOf(card.state.cursorRun.by, bots),
					since: ageLabel(card.state.cursorRun.startedAt, now),
				}
			: null,
	};
}

export function toBotCard(card: Card, bots: readonly BotProfile[]): BotCardView {
	return {
		id: card.id,
		shortId: card.id.replaceAll("-", "").slice(0, 6),
		column: columnOf(card.state),
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
		run: card.state.botRun
			? {
					bot: memberOf(card.state.botRun.bot, bots).name,
					status: card.state.botRun.status,
					requestedAt: new Date(card.state.botRun.requestedAt).toISOString(),
					startedAt: card.state.botRun.startedAt === null ? null : new Date(card.state.botRun.startedAt).toISOString(),
					passedOnBy: card.state.botRun.passedOn ? memberOf(card.state.botRun.passedOn.by, bots).name : null,
					passedOnAt: card.state.botRun.passedOn ? new Date(card.state.botRun.passedOn.at).toISOString() : null,
				}
			: null,
		cursor: card.state.cursorRun
			? {
					status: card.state.cursorRun.status,
					agentUrl: card.state.cursorRun.agent?.url ?? null,
					by: memberOf(card.state.cursorRun.by, bots).name,
					startedAt: new Date(card.state.cursorRun.startedAt).toISOString(),
				}
			: null,
	};
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
	if (sec < 60) return "just now";
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 48) return `${hr}h`;
	return `${Math.floor(hr / 24)}d`;
}

/**
 * The details as one run of plain text, for the two-line preview on a card. Markdown marks and blank lines
 * are dropped, so the preview starts with words instead of `##` or an empty line.
 */
export function excerpt(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
		.replace(/(\*\*|__|`|~~)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

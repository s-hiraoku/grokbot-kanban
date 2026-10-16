"use client";

import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	closestCenter,
	closestCorners,
	pointerWithin,
	useDroppable,
	useSensor,
	useSensors,
	type CollisionDetection,
	type UniqueIdentifier,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MemberAvatar } from "@/components/Avatar";
import BotsPanel from "@/components/BotsPanel";
import CardDrawer from "@/components/CardDrawer";
import CardPanel, { type CardHandlers } from "@/components/CardPanel";
import { COLUMNS, type Column, type ParkColumn } from "@/lib/domain";
import { actionBlocked, dropHint, dropRefusal, dropTargets } from "@/lib/dropRules";
import { OFFLINE_TOAST, ONLINE_TOAST, UNREACHABLE_TOAST, commandToast, pushToast, type ToastMessage } from "@/lib/notify";
import Toasts, { type ShownToast } from "@/components/Toasts";
import type { BoardView, BotView, CardView, MemberView } from "@/lib/view";

export type Command =
	| { type: "create"; content: Record<string, unknown> }
	| { type: "edit"; cardId: string; patch: Record<string, unknown> }
	| { type: "move"; cardId: string; to: ParkColumn }
	| { type: "run"; cardId: string }
	| { type: "stop"; cardId: string }
	| { type: "drop"; cardId: string; column: Column; index: number }
	| { type: "saveBot"; id: string | null; profile: Record<string, unknown> }
	| { type: "deleteBot"; id: string }
	| { type: "deleteCard"; cardId: string }
	| { type: "setOwnerAvatar"; avatar: string | null };

type Order = Record<Column, string[]>;

const OWNER: MemberView = { id: "owner", name: "You", kind: "owner", avatar: null, color: "#f2b33d", initials: "You" };
const MEMBER_DROP = "member:";
const FOLDABLE: readonly Column[] = ["done", "wontDo"];
const FOLD_KEY = "grokbot-kanban.folded";

/** Starts a drag only from the card body, never from its buttons, fields, or links. */
function blocksDrag(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[data-no-dnd], button, input, textarea, select, a, summary, label") !== null;
}

class CardPointerSensor extends PointerSensor {
	static activators = [
		{
			eventName: "onPointerDown" as const,
			// Touch goes to CardTouchSensor, which waits for a press so a swipe still scrolls the board.
			handler: ({ nativeEvent }: ReactPointerEvent) =>
				nativeEvent.isPrimary && nativeEvent.button === 0 && nativeEvent.pointerType !== "touch" && !blocksDrag(nativeEvent.target),
		},
	];
}

class CardTouchSensor extends TouchSensor {
	static activators = [
		{
			eventName: "onTouchStart" as const,
			handler: ({ nativeEvent }: React.TouchEvent) => !blocksDrag(nativeEvent.target),
		},
	];
}

function orderOf(board: BoardView): Order {
	return Object.fromEntries(board.columns.map((column) => [column.id, column.cards.map((card): string => card.id)])) as unknown as Order;
}


export default function Board({ initial, studioUrl }: { initial: BoardView; studioUrl: string | null }) {
	const [board, setBoard] = useState(initial);
	const [order, setOrder] = useState<Order>(() => orderOf(initial));
	const [toasts, setToasts] = useState<ShownToast[]>([]);
	const toastId = useRef(0);
	const notify = useCallback((message: ToastMessage) => setToasts((current) => pushToast(current, { ...message, id: ++toastId.current })), []);
	const dismiss = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);
	const offline = useRef(0);
	const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; cardId: string } | null>(null);
	const [botsOpen, setBotsOpen] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [memberFilter, setMemberFilter] = useState<string | null>(null);
	const [highlight, setHighlight] = useState<string | null>(null);
	// Won't Do starts folded so the working columns fit a laptop screen.
	const [folded, setFolded] = useState<Column[]>(["wontDo"]);
	const [quickAdd, setQuickAdd] = useState(false);
	const [overMember, setOverMember] = useState(false);
	const dragging = useRef(false);
	const pending = useRef<BoardView | null>(null);
	const dragOrigin = useRef<Column | null>(null);
	const droppedAt = useRef(0);
	const lastOver = useRef<UniqueIdentifier | null>(null);
	const orderRef = useRef(order);
	orderRef.current = order;
	const justMoved = useRef(false);

	// Moving a card into another column resizes both, which can flip the nearest target back and forth.
	// Hold the last target for one frame after a move so the drag settles.
	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			justMoved.current = false;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [order]);

	/** Small targets (dock members, folded columns) take the drop only when the pointer is on them; elsewhere the nearest column or card wins. */
	const collision = useCallback<CollisionDetection>((args) => {
		const isPinpoint = (item: (typeof args.droppableContainers)[number]) => item.data.current?.pinpoint === true;
		const hit = pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter(isPinpoint) });
		if (hit.length) return hit;
		if (justMoved.current && lastOver.current !== null) return [{ id: lastOver.current }];
		const open = args.droppableContainers.filter((item) => !isPinpoint(item));
		// The column under the pointer decides; within it the nearest card sets the position.
		const column = pointerWithin({ ...args, droppableContainers: open.filter((item) => String(item.id).startsWith("column:")) })[0];
		let hits = column ? [column] : closestCorners({ ...args, droppableContainers: open });
		if (column) {
			const inColumn = new Set(orderRef.current[String(column.id).slice("column:".length) as Column] ?? []);
			const cardsHere = open.filter((item) => inColumn.has(String(item.id)));
			if (cardsHere.length) hits = closestCenter({ ...args, droppableContainers: cardsHere });
		}
		lastOver.current = hits[0]?.id ?? null;
		return hits;
	}, []);

	const cards = useMemo(() => new Map<string, CardView>(board.columns.flatMap((column) => column.cards.map((card) => [card.id, card] as const))), [board]);
	const owner = useMemo<MemberView>(() => ({ ...OWNER, avatar: board.owner.avatar }), [board.owner.avatar]);
	const members = useMemo<MemberView[]>(() => [owner, ...board.bots], [owner, board.bots]);
	const activeCard = activeId ? cards.get(activeId) ?? null : null;
	const allowed = activeCard ? dropTargets(activeCard) : null;

	const accept = useCallback((next: BoardView) => {
		if (dragging.current) {
			pending.current = next;
			return;
		}
		setBoard(next);
		setOrder(orderOf(next));
	}, []);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(FOLD_KEY);
			if (raw === null) return;
			const saved = JSON.parse(raw) as unknown;
			if (Array.isArray(saved)) setFolded(saved.filter((item): item is Column => FOLDABLE.includes(item as Column)));
		} catch {
			// No saved layout. Every column starts open.
		}
	}, []);

	const toggleFold = (column: Column) =>
		setFolded((current) => {
			const next = current.includes(column) ? current.filter((item) => item !== column) : [...current, column];
			try {
				window.localStorage.setItem(FOLD_KEY, JSON.stringify(next));
			} catch {
				// Storage is off. The fold still holds until reload.
			}
			return next;
		});


	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/owner/sync", { method: "POST" });
			if (response.status === 401) {
				window.location.href = "/login";
				return;
			}
			if (!response.ok) throw new Error(String(response.status));
			accept((await response.json()) as BoardView);
			if (offline.current >= 2) notify(ONLINE_TOAST);
			offline.current = 0;
		} catch {
			// One miss is usually a blip. Say so on the second, once, and keep retrying.
			offline.current += 1;
			if (offline.current === 2) notify(OFFLINE_TOAST);
		}
	}, [accept, notify]);

	// Fast while an agent is queued or running, slower otherwise so bot edits still show up.
	const live = board.agents.running + board.agents.queued > 0;
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refresh();
		}, live ? 4000 : 15000);
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
	}, [live, refresh]);

	useEffect(() => {
		const id = new URLSearchParams(window.location.search).get("card");
		if (!id) return;
		setHighlight(id);
		window.requestAnimationFrame(() => document.querySelector(`[data-card-id="${window.CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }));
		const timer = window.setTimeout(() => setHighlight(null), 4000);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "n") {
				event.preventDefault();
				setDrawer({ mode: "create" });
			}
			if (event.key === "/") {
				event.preventDefault();
				document.getElementById("board-search")?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	async function send(command: Command): Promise<boolean> {
		try {
			const response = await fetch("/api/owner/commands", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(command),
			});
			if (response.status === 401) {
				window.location.href = "/login";
				return false;
			}
			const payload = (await response.json().catch(() => ({}))) as { board?: BoardView; notice?: string | null; tone?: string | null };
			if (payload.board) accept(payload.board);
			else if (!response.ok) await refresh();
			const message = commandToast(response.status, payload);
			if (message) notify(message);
			// A warning means the board did something other than what was asked, so callers treat it as not done.
			return response.ok && payload.tone !== "warning" && payload.tone !== "error";
		} catch {
			notify(UNREACHABLE_TOAST);
			await refresh();
			return false;
		}
	}

	const handlersFor = (card: CardView): CardHandlers => ({
		onRun: () => void send({ type: "run", cardId: card.id }),
		onStop: () => void send({ type: "stop", cardId: card.id }),
		onOpen: () => {
			// The click that ends a drag is not a request to open the card.
			if (Date.now() - droppedAt.current > 250) setDrawer({ mode: "edit", cardId: card.id });
		},
		onDelete: () => {
			if (window.confirm(`Delete “${card.title}”? This cannot be undone.`)) void send({ type: "deleteCard", cardId: card.id });
		},
		onBlocked: (reason) => notify({ text: reason, tone: "warning" }),
	});

	const needle = query.trim().toLowerCase();
	const visible = (card: CardView) => {
		if (memberFilter === "none" && card.assignees.length > 0) return false;
		if (memberFilter && memberFilter !== "none" && !card.assignees.some((member) => member.id === memberFilter) && card.createdBy?.id !== memberFilter) {
			return false;
		}
		if (!needle) return true;
		return [card.title, card.body, card.notes, card.shortId, card.repoLabel ?? "", ...card.assignees.map((member) => member.name)].some((text) =>
			text.toLowerCase().includes(needle),
		);
	};
	const filtering = Boolean(needle || memberFilter);
	const unassigned = board.columns.reduce((sum, column) => sum + column.cards.filter((card) => card.assignees.length === 0).length, 0);
	const ownerLoad = board.columns.reduce((sum, column) => sum + column.cards.filter((card) => card.assignees.some((member) => member.id === OWNER.id)).length, 0);

	const sensors = useSensors(
		useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(CardTouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
		// Space picks a card up. Enter stays free to open it.
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
	);

	const containerOf = (id: string): Column | null => {
		if (id.startsWith("column:")) return id.slice("column:".length) as Column;
		for (const column of COLUMNS) if (order[column.id]?.includes(id)) return column.id;
		return null;
	};

	function onDragStart(event: DragStartEvent) {
		dragging.current = true;
		lastOver.current = null;
		const id = String(event.active.id);
		setActiveId(id);
		dragOrigin.current = containerOf(id);
	}

	function onDragOver(event: DragOverEvent) {
		const { active, over } = event;
		setOverMember(Boolean(over && String(over.id).startsWith(MEMBER_DROP)));
		if (!over) return;
		const id = String(active.id);
		const from = containerOf(id);
		const to = containerOf(String(over.id));
		const card = cards.get(id);
		if (!from || !to || from === to || !card || !dropTargets(card).has(to)) return;
		justMoved.current = true;
		setOrder((current) => {
			const source = current[from].filter((item) => item !== id);
			const target = [...current[to]];
			const overIndex = target.indexOf(String(over.id));
			// A folded column shows no cards, so a card dropped on it goes to the top where it is seen first on unfold.
			const at = overIndex >= 0 ? overIndex : folded.includes(to) ? 0 : target.length;
			target.splice(at, 0, id);
			return { ...current, [from]: source, [to]: target };
		});
	}

	function finishDrag() {
		dragging.current = false;
		droppedAt.current = Date.now();
		setOverMember(false);
		setActiveId(null);
		const queued = pending.current;
		pending.current = null;
		return queued;
	}

	function onDragCancel() {
		const queued = finishDrag();
		setOrder(orderOf(queued ?? board));
		if (queued) setBoard(queued);
	}

	function onDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		const queued = finishDrag();
		const id = String(active.id);
		const card = cards.get(id);
		const overId = over ? String(over.id) : null;
		if (card && overId?.startsWith(MEMBER_DROP)) {
			setOrder(orderOf(queued ?? board));
			if (queued) setBoard(queued);
			assignByDrop(card, overId.slice(MEMBER_DROP.length));
			return;
		}
		const to = overId ? containerOf(overId) : null;
		const origin = dragOrigin.current;
		if (!card || !to || !dropTargets(card).has(to)) {
			setOrder(orderOf(queued ?? board));
			if (card && to && to !== card.column) notify({ text: dropRefusal(card, to), tone: "warning" });
			return;
		}
		let list = order[to];
		const overIndex = list.indexOf(overId!);
		const fromIndex = list.indexOf(id);
		if (fromIndex >= 0 && overIndex >= 0 && fromIndex !== overIndex) list = arrayMove(list, fromIndex, overIndex);
		const nextOrder = { ...order, [to]: list };
		const index = fullIndex(board, to, list, id, filtering ? (other: string) => visible(cards.get(other)!) : null);
		const unchanged = origin === to && orderOf(board)[to]?.join() === list.join();
		setOrder(nextOrder);
		if (unchanged) return;
		setBoard(optimistic(board, id, to, list));
		void send({ type: "drop", cardId: id, column: to, index });
	}

	function assignByDrop(card: CardView, memberId: string) {
		const member = members.find((item) => item.id === memberId);
		const ids = card.assignees.map((item) => item.id);
		if (!member) return;
		if (ids.includes(memberId)) {
			notify({ text: `${member.name === "You" ? "You already have" : `${member.name} already has`} this card.`, tone: "warning" });
			return;
		}
		void send({ type: "edit", cardId: card.id, patch: { assignees: [...ids, memberId] } }).then((ok) => {
			if (ok) notify({ text: member.id === OWNER.id ? "Assigned to you." : `Assigned to ${member.name}.`, tone: "success" });
		});
	}

	const editing = drawer?.mode === "edit" ? cards.get(drawer.cardId) ?? null : null;
	const shown = board.columns.reduce((sum, column) => sum + column.cards.filter(visible).length, 0);

	return (
		<DndContext id="board" sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
			<div className={`shell${activeCard ? " is-dragging" : ""}`}>
				<header className="top">
					<div className="brand">
						{studioUrl ? (
							<a className="studio" href={studioUrl} aria-label="Back to the studio">
								‹
							</a>
						) : null}
						<h1>Grok Bot</h1>
					</div>
					<label className="search">
						<span className="visually-hidden">Search cards</span>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<circle cx="9" cy="9" r="5.5" />
							<path d="M13.2 13.2 17 17" />
						</svg>
						<input id="board-search" type="search" placeholder="Search cards" value={query} onChange={(event) => setQuery(event.target.value)} lang="ja" />
						<kbd>/</kbd>
					</label>
					<SlotMeter running={board.agents.running} queued={board.agents.queued} capacity={board.agents.capacity} />
					<button type="button" className="primary new-card" onClick={() => setDrawer({ mode: "create" })} title="Shortcut: n">
						<span aria-hidden="true">＋</span> New card
					</button>
				</header>

				<nav className="dock" aria-label="Team">
					{/* Header and footer stay put; only the bots scroll between them. */}
					<div className="dock-head">
						<p className="dock-hint">{activeCard ? "Drop to assign" : "Team"}</p>
						<DockMember member={owner} load={ownerLoad} active={memberFilter === OWNER.id} onClick={() => setMemberFilter((current) => (current === OWNER.id ? null : OWNER.id))} droppable={Boolean(activeCard)} />
					</div>
					<div className="dock-list">
						{board.bots.map((bot) => (
							<DockMember
								key={bot.id}
								member={bot}
								load={bot.assigned}
								active={memberFilter === bot.id}
								onClick={() => setMemberFilter((current) => (current === bot.id ? null : bot.id))}
								droppable={Boolean(activeCard)}
							/>
						))}
						{board.bots.length === 0 ? <p className="dock-empty">No bots yet</p> : null}
					</div>
					<div className="dock-foot">
						<button
							type="button"
							className={`dock-item dock-none${memberFilter === "none" ? " active" : ""}`}
							aria-pressed={memberFilter === "none"}
							onClick={() => setMemberFilter((current) => (current === "none" ? null : "none"))}
							title="Open cards with no assignee"
						>
							<span className="dock-face" aria-hidden="true">
								<span className="none-ring" />
							</span>
							<span className="dock-name">Unassigned</span>
							<span className="dock-load">{unassigned}</span>
						</button>
						<button type="button" className="ghost" onClick={() => setBotsOpen(true)}>
							Bots & MCP
						</button>
						<form method="post" action="/api/auth/logout">
							<button type="submit" className="ghost quiet">
								Sign out
							</button>
						</form>
					</div>
				</nav>

				<main className="lanes">
					{filtering ? (
						<p className="filter-note" role="status">
							Showing {shown} of {cards.size} cards
							<button
								type="button"
								className="link"
								onClick={() => {
									setQuery("");
									setMemberFilter(null);
								}}
							>
								Clear filters
							</button>
						</p>
					) : null}
					<div className="columns">
						{board.columns.map((column) => {
							const ids = (order[column.id] ?? []).filter((id) => cards.has(id) && visible(cards.get(id)!));
							const state = allowed ? (allowed.has(column.id) ? "can-drop" : "no-drop") : "";
							const isFolded = folded.includes(column.id);
							return (
								<ColumnShell
									key={column.id}
									id={column.id}
									label={column.label}
									count={(order[column.id] ?? []).length}
									state={state}
									hint={dropHint(activeCard, column.id)}
									folded={isFolded}
									onFold={FOLDABLE.includes(column.id) ? () => toggleFold(column.id) : null}
									onAdd={column.id === "inbox" ? () => setQuickAdd(true) : null}
								>
									{column.id === "inbox" && quickAdd ? (
										<QuickAdd
											onCancel={() => setQuickAdd(false)}
											onAdd={async (title) => send({ type: "create", content: { title } })}
										/>
									) : null}
									{isFolded ? null : (
										<SortableContext items={ids} strategy={verticalListSortingStrategy}>
											{ids.length === 0 ? <p className="empty">{filtering ? "No matching cards" : emptyText(column.id)}</p> : null}
											{ids.map((id) => {
												const card = cards.get(id)!;
												return <SortableCard key={id} card={card} handlers={handlersFor(card)} highlighted={highlight === id} />;
											})}
										</SortableContext>
									)}
								</ColumnShell>
							);
						})}
					</div>
				</main>

				<DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>{activeCard ? <CardPanel card={activeCard} handlers={handlersFor(activeCard)} overlay className={overMember ? "to-member" : undefined} /> : null}</DragOverlay>

				{drawer ? (
					<CardDrawer
						key={editing?.id ?? "new"}
						card={editing}
						members={members}
						onClose={() => setDrawer(null)}
						send={send}
						notify={notify}
						onSubmit={async (payload) => {
							const ok = editing ? await send({ type: "edit", cardId: editing.id, patch: payload }) : await send({ type: "create", content: payload });
							if (ok) setDrawer(null);
							return ok;
						}}
					/>
				) : null}
				{botsOpen ? <BotsPanel bots={board.bots} owner={owner} onClose={() => setBotsOpen(false)} send={send} notify={notify} /> : null}
				<Toasts toasts={toasts} onDismiss={dismiss} />
			</div>
		</DndContext>
	);
}

function SlotMeter({ running, queued, capacity }: { running: number; queued: number; capacity: number }) {
	const label = `${running} of ${capacity} agents running${queued ? `, ${queued} waiting` : ""}`;
	return (
		<div className="slots" role="img" aria-label={label} title={label}>
			<span className="slots-lights" aria-hidden="true">
				{Array.from({ length: capacity }, (_, index) => (
					<span key={index} className={index < running ? "light on" : "light"} />
				))}
			</span>
			<span className="slots-text" aria-hidden="true">
				{running}/{capacity}
				{queued ? <span className="slots-queue">+{queued} waiting</span> : null}
			</span>
		</div>
	);
}

function DockMember({ member, load, active, onClick, droppable }: { member: MemberView | BotView; load: number; active: boolean; onClick: () => void; droppable: boolean }) {
	const { setNodeRef, isOver } = useDroppable({ id: `${MEMBER_DROP}${member.id}`, disabled: !droppable, data: { pinpoint: true } });
	const bot = "role" in member ? member : null;
	const title = bot ? [bot.name, bot.role, bot.lastSeen === null ? "Not seen yet" : bot.lastSeen === "just now" ? "Seen just now" : `Last seen ${bot.lastSeen} ago`].filter(Boolean).join("\n") : "You";
	return (
		<button
			ref={setNodeRef}
			type="button"
			className={`dock-item${active ? " active" : ""}${isOver ? " over" : ""}`}
			aria-pressed={active}
			onClick={onClick}
			title={title}
			style={{ "--member": member.color } as React.CSSProperties}
		>
			<span className="dock-face">
				<MemberAvatar member={member} size={40} />
			</span>
			<span className="dock-name" lang="ja">
				{member.name}
			</span>
			<span className="dock-load" aria-label={`${load} cards`}>
				{load}
			</span>
		</button>
	);
}

function ColumnShell({
	id,
	label,
	count,
	state,
	hint,
	folded,
	onFold,
	onAdd,
	children,
}: {
	id: Column;
	label: string;
	count: number;
	state: string;
	hint: string | null;
	folded: boolean;
	onFold: (() => void) | null;
	onAdd: (() => void) | null;
	children: React.ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `column:${id}`, data: { pinpoint: folded } });
	return (
		<section ref={setNodeRef} className={`column col-${id} ${state}${isOver ? " over" : ""}${folded ? " folded" : ""}`} aria-label={label}>
			<header>
				<span className="lamp" aria-hidden="true" />
				<h2>{label}</h2>
				<span className="count">{count}</span>
				{onAdd ? (
					<button type="button" className="icon add" aria-label="Add a card to Inbox" title="Add a card" onClick={onAdd}>
						＋
					</button>
				) : null}
				{onFold ? (
					<button type="button" className="icon fold" aria-label={folded ? `Show ${label}` : `Fold ${label}`} aria-expanded={!folded} onClick={onFold}>
						{folded ? "›" : "‹"}
					</button>
				) : null}
			</header>
			{hint ? <p className="drop-hint">{hint}</p> : null}
			<div className="column-body">{children}</div>
		</section>
	);
}

function QuickAdd({ onAdd, onCancel }: { onAdd: (title: string) => Promise<boolean>; onCancel: () => void }) {
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);
	return (
		<form
			className="quick-add"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!title.trim()) return;
				setBusy(true);
				const ok = await onAdd(title.trim());
				setBusy(false);
				if (ok) {
					setTitle("");
					input.current?.focus();
				}
			}}
		>
			<input
				ref={input}
				value={title}
				onChange={(event) => setTitle(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onCancel();
				}}
				placeholder="Card title, then Enter"
				aria-label="New card title"
				maxLength={200}
				lang="ja"
				disabled={busy}
			/>
			<button type="button" className="ghost small" onClick={onCancel}>
				Done
			</button>
		</form>
	);
}

function SortableCard({ card, handlers, highlighted }: { card: CardView; handlers: CardHandlers; highlighted: boolean }) {
	const draggable = card.moveTargets.length > 0;
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !draggable });
	// A locked card does not follow the pointer, so a drag attempt on it says why instead of doing nothing.
	const press = useRef<{ x: number; y: number; told: boolean } | null>(null);
	const explain = () => {
		const reason = actionBlocked(card, "move");
		if (reason) handlers.onBlocked(reason);
	};
	const lockedHandlers = draggable
		? {}
		: {
				onPointerDown: (event: React.PointerEvent) => {
					if (event.button === 0 && !(event.target instanceof Element && event.target.closest("button, a, [data-no-dnd]"))) {
						press.current = { x: event.clientX, y: event.clientY, told: false };
					}
				},
				onPointerMove: (event: React.PointerEvent) => {
					const start = press.current;
					if (!start || start.told || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
					start.told = true;
					explain();
				},
				// The click that ends a refused drag is not a request to open the card.
				onClickCapture: (event: React.MouseEvent) => {
					if (press.current?.told) event.stopPropagation();
					press.current = null;
				},
				onPointerCancel: () => {
					press.current = null;
				},
				onKeyDown: (event: React.KeyboardEvent) => {
					if (event.key === " " && event.target === event.currentTarget) {
						event.preventDefault();
						explain();
					}
				},
			};
	return (
		<CardPanel
			ref={setNodeRef}
			card={card}
			handlers={handlers}
			dragging={isDragging}
			highlighted={highlighted}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={draggable ? "grab" : "locked"}
			{...attributes}
			{...listeners}
			{...lockedHandlers}
			aria-roledescription={draggable ? "draggable card" : "card"}
			// A running card cannot be dragged, but it still opens.
			aria-disabled={undefined}
		/>
	);
}

function emptyText(column: Column): string {
	if (column === "inbox") return "New requests from bots land here";
	if (column === "todo") return "Drop a card here to queue it";
	if (column === "inProgress") return "Nothing in progress";
	if (column === "inReview") return "Cards waiting for review, including agent PRs";
	return "Nothing here yet";
}



/** The drop position among every card in the column, so a filtered view still lands next to its visible neighbour. */
function fullIndex(board: BoardView, to: Column, list: string[], id: string, isVisible: ((id: string) => boolean) | null): number {
	const position = list.indexOf(id);
	if (!isVisible) return Math.max(0, position);
	const siblings = (board.columns.find((column) => column.id === to)?.cards ?? []).map((card): string => card.id).filter((item) => item !== id);
	const before = list.slice(0, position).filter((item) => item !== id && isVisible(item)).pop();
	if (!before) return 0;
	return siblings.indexOf(before) + 1;
}

function optimistic(board: BoardView, id: string, to: Column, list: string[]): BoardView {
	const card = board.columns.flatMap((column) => column.cards).find((item) => item.id === id);
	if (!card) return board;
	const moved = { ...card, column: to };
	const byId = new Map<string, CardView>(board.columns.flatMap((column) => column.cards).map((item) => [item.id, item]));
	byId.set(id, moved);
	return {
		...board,
		columns: board.columns.map((column) => {
			const ids = column.id === to ? list : column.cards.map((item): string => item.id).filter((item) => item !== id);
			const nextCards = ids.map((item) => byId.get(item)).filter((item): item is CardView => Boolean(item));
			return { ...column, cards: nextCards, count: nextCards.length };
		}),
	};
}

"use client";

import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	closestCorners,
	useDroppable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MemberAvatar } from "@/components/Avatar";
import BotsPanel from "@/components/BotsPanel";
import CardEditor from "@/components/CardEditor";
import CardPanel, { type CardHandlers } from "@/components/CardPanel";
import { COLUMNS, type Column, type ParkColumn } from "@/lib/domain";
import type { BoardView, CardView, MemberView } from "@/lib/view";

export type Command =
	| { type: "create"; content: Record<string, unknown> }
	| { type: "edit"; cardId: string; patch: Record<string, unknown> }
	| { type: "move"; cardId: string; to: ParkColumn }
	| { type: "run"; cardId: string }
	| { type: "stop"; cardId: string }
	| { type: "drop"; cardId: string; column: Column; index: number }
	| { type: "saveBot"; id: string | null; profile: Record<string, unknown> }
	| { type: "deleteBot"; id: string };

type Order = Record<Column, string[]>;

const OWNER: MemberView = { id: "owner", name: "You", kind: "owner", avatar: null, color: "#d7c4a3", initials: "You" };

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

function dropTargets(card: CardView): Set<Column> {
	const targets = new Set<Column>(card.moveTargets);
	targets.add(card.column);
	if (card.action.command === "run" && card.action.enabled && card.repo) {
		targets.add("todo");
		targets.add("inProgress");
	}
	return targets;
}

export default function Board({ initial, studioUrl }: { initial: BoardView; studioUrl: string | null }) {
	const [board, setBoard] = useState(initial);
	const [order, setOrder] = useState<Order>(() => orderOf(initial));
	const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
	const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; cardId: string } | null>(null);
	const [botsOpen, setBotsOpen] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [memberFilter, setMemberFilter] = useState<string | null>(null);
	const [highlight, setHighlight] = useState<string | null>(null);
	const dragging = useRef(false);
	const pending = useRef<BoardView | null>(null);
	const dragOrigin = useRef<Column | null>(null);

	const cards = useMemo(() => new Map<string, CardView>(board.columns.flatMap((column) => column.cards.map((card) => [card.id, card] as const))), [board]);
	const members = useMemo<MemberView[]>(() => [OWNER, ...board.bots], [board.bots]);
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
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 4200);
		return () => window.clearTimeout(timer);
	}, [toast]);

	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/owner/sync", { method: "POST" });
			if (response.status === 401) {
				window.location.href = "/login";
				return;
			}
			if (response.ok) accept((await response.json()) as BoardView);
		} catch {
			// Offline for a moment. The next tick tries again.
		}
	}, [accept]);

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
			if (event.key === "n" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				setEditor({ mode: "create" });
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
			const payload = (await response.json().catch(() => ({}))) as { board?: BoardView; notice?: string | null; error?: string };
			if (payload.board) accept(payload.board);
			else if (!response.ok) await refresh();
			if (payload.notice) setToast({ text: payload.notice, tone: response.ok ? "info" : "error" });
			else if (!response.ok) setToast({ text: response.status === 503 ? "The board is busy. Try again." : "That did not go through.", tone: "error" });
			return response.ok;
		} catch {
			setToast({ text: "Could not reach the board. Check your connection.", tone: "error" });
			await refresh();
			return false;
		}
	}

	const handlersFor = (card: CardView): CardHandlers => ({
		onRun: () => void send({ type: "run", cardId: card.id }),
		onStop: () => void send({ type: "stop", cardId: card.id }),
		onMove: (to) => void send({ type: "move", cardId: card.id, to }),
		onEdit: (patch) => void send({ type: "edit", cardId: card.id, patch }),
		onOpen: () => setEditor({ mode: "edit", cardId: card.id }),
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

	const sensors = useSensors(
		useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(CardTouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const containerOf = (id: string): Column | null => {
		if (id.startsWith("column:")) return id.slice("column:".length) as Column;
		for (const column of COLUMNS) if (order[column.id]?.includes(id)) return column.id;
		return null;
	};

	function onDragStart(event: DragStartEvent) {
		dragging.current = true;
		const id = String(event.active.id);
		setActiveId(id);
		dragOrigin.current = containerOf(id);
	}

	function onDragOver(event: DragOverEvent) {
		const { active, over } = event;
		if (!over) return;
		const id = String(active.id);
		const from = containerOf(id);
		const to = containerOf(String(over.id));
		const card = cards.get(id);
		if (!from || !to || from === to || !card || !dropTargets(card).has(to)) return;
		setOrder((current) => {
			const source = current[from].filter((item) => item !== id);
			const target = [...current[to]];
			const overIndex = target.indexOf(String(over.id));
			target.splice(overIndex >= 0 ? overIndex : target.length, 0, id);
			return { ...current, [from]: source, [to]: target };
		});
	}

	function finishDrag() {
		dragging.current = false;
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
		const to = over ? containerOf(String(over.id)) : null;
		const origin = dragOrigin.current;
		if (!card || !to || !dropTargets(card).has(to)) {
			setOrder(orderOf(queued ?? board));
			if (card && to && to !== card.column) setToast({ text: refusal(card, to), tone: "error" });
			return;
		}
		let list = order[to];
		const overIndex = list.indexOf(String(over!.id));
		const fromIndex = list.indexOf(id);
		if (fromIndex >= 0 && overIndex >= 0 && fromIndex !== overIndex) list = arrayMove(list, fromIndex, overIndex);
		const nextOrder = { ...order, [to]: list };
		const index = fullIndex(board, to, list, id, filtering ? (card2: string) => visible(cards.get(card2)!) : null);
		const unchanged = origin === to && orderOf(board)[to]?.join() === list.join();
		setOrder(nextOrder);
		if (unchanged) return;
		setBoard(optimistic(board, id, to, list));
		void send({ type: "drop", cardId: id, column: to, index });
	}

	const editing = editor?.mode === "edit" ? cards.get(editor.cardId) ?? null : null;

	return (
		<div className="shell">
			<header className="top">
				<a className="studio" href={studioUrl ?? "#"}>
					← Studio
				</a>
				<h1>Grok Bot</h1>
				<div className="roster" aria-label="Filter by member">
					{members.map((member) => (
						<button
							key={member.id}
							type="button"
							className={`roster-chip${memberFilter === member.id ? " active" : ""}`}
							onClick={() => setMemberFilter((current) => (current === member.id ? null : member.id))}
							title={member.kind === "bot" ? `${member.name}${"role" in member && member.role ? ` · ${member.role}` : ""}` : "Cards assigned to you"}
						>
							<MemberAvatar member={member} size={24} />
							{"assigned" in member ? <span className="roster-count">{(member as { assigned: number }).assigned}</span> : null}
						</button>
					))}
					<button type="button" className={`roster-chip text${memberFilter === "none" ? " active" : ""}`} onClick={() => setMemberFilter((current) => (current === "none" ? null : "none"))}>
						Unassigned
					</button>
				</div>
				<div className="top-actions">
					<input
						id="board-search"
						className="search"
						type="search"
						placeholder="Search  /"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						lang="ja"
					/>
					<button type="button" className="ghost" onClick={() => setBotsOpen(true)}>
						Bots & MCP
					</button>
					<button type="button" className="primary" onClick={() => setEditor({ mode: "create" })} title="Shortcut: n">
						New card
					</button>
					<form method="post" action="/api/auth/logout">
						<button type="submit" className="ghost">
							Sign out
						</button>
					</form>
					<p className="agents">
						Agents {board.agents.running}/{board.agents.capacity} running
					</p>
				</div>
			</header>
			{filtering ? (
				<p className="filter-note">
					Showing {board.columns.reduce((sum, column) => sum + column.cards.filter(visible).length, 0)} of {cards.size} cards.{" "}
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
			<DndContext id="board" sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
				<div className="columns">
					{board.columns.map((column) => {
						const ids = (order[column.id] ?? []).filter((id) => cards.has(id) && visible(cards.get(id)!));
						const state = allowed ? (allowed.has(column.id) ? "can-drop" : "no-drop") : "";
						return (
							<ColumnShell key={column.id} id={column.id} label={column.label} dot={column.dot} count={(order[column.id] ?? []).length} state={state} hint={dropHint(activeCard, column.id)}>
								<SortableContext items={ids} strategy={verticalListSortingStrategy}>
									{ids.length === 0 ? <p className="empty">{filtering ? "No matches" : "Nothing here"}</p> : null}
									{ids.map((id) => {
										const card = cards.get(id)!;
										return (
											<SortableCard key={id} card={card} members={members} handlers={handlersFor(card)} highlighted={highlight === id} />
										);
									})}
								</SortableContext>
							</ColumnShell>
						);
					})}
				</div>
				<DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
					{activeCard ? <CardPanel card={activeCard} members={members} handlers={handlersFor(activeCard)} overlay /> : null}
				</DragOverlay>
			</DndContext>
			{editor ? (
				<CardEditor
					card={editing}
					members={members}
					onClose={() => setEditor(null)}
					onSubmit={async (payload) => {
						const ok = editing
							? await send({ type: "edit", cardId: editing.id, patch: payload })
							: await send({ type: "create", content: payload });
						if (ok) setEditor(null);
					}}
				/>
			) : null}
			{botsOpen ? <BotsPanel bots={board.bots} onClose={() => setBotsOpen(false)} send={send} /> : null}
			{toast ? (
				<div className={`toast ${toast.tone}`} role="status">
					{toast.text}
				</div>
			) : null}
		</div>
	);
}

function ColumnShell({
	id,
	label,
	dot,
	count,
	state,
	hint,
	children,
}: {
	id: Column;
	label: string;
	dot: string;
	count: number;
	state: string;
	hint: string | null;
	children: React.ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `column:${id}` });
	return (
		<section ref={setNodeRef} className={`column ${state}${isOver ? " over" : ""}`} aria-label={label}>
			<header>
				<span className="dot" style={{ background: dot }} />
				<h2>{label}</h2>
				<span className="count">{count}</span>
			</header>
			{hint ? <p className="drop-hint">{hint}</p> : null}
			{children}
		</section>
	);
}

function SortableCard({ card, members, handlers, highlighted }: { card: CardView; members: readonly MemberView[]; handlers: CardHandlers; highlighted: boolean }) {
	const draggable = card.moveTargets.length > 0;
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !draggable });
	return (
		<CardPanel
			ref={setNodeRef}
			card={card}
			members={members}
			handlers={handlers}
			dragging={isDragging}
			highlighted={highlighted}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={draggable ? "grab" : "locked"}
			{...attributes}
			{...listeners}
			aria-roledescription={draggable ? "draggable card" : "card"}
		/>
	);
}

function dropHint(card: CardView | null, column: Column): string | null {
	if (!card || column === card.column) return null;
	const targets = dropTargets(card);
	if (!targets.has(column)) return column === "inReview" ? "Filled by agent PRs" : card.repo ? null : column === "inProgress" ? "Set a repo first" : null;
	if (column === "todo" || column === "inProgress") return card.repo && card.action.command === "run" ? "Drop to run the agent" : "Drop to park";
	return null;
}

function refusal(card: CardView, column: Column): string {
	if (card.moveTargets.length === 0) return "Stop the agent before moving this card.";
	if (column === "inReview") return "Cards reach In Review when an agent opens a PR.";
	if (column === "inProgress" && !card.repo) return "Set a repo before running.";
	return "That column does not take this card.";
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

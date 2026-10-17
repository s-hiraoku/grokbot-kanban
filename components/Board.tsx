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
import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon, PlusIcon, SearchIcon, SettingsIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MemberAvatar } from "@/components/Avatar";
import BotsPanel from "@/components/BotsPanel";
import CardDrawer from "@/components/CardDrawer";
import CardPanel, { type CardHandlers } from "@/components/CardPanel";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { ThemeMenu } from "@/components/ThemeMenu";
import Toasts, { showToast } from "@/components/Toasts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COLUMNS, type Column, type ParkColumn } from "@/lib/domain";
import { OFFLINE_TOAST, ONLINE_TOAST, UNREACHABLE_TOAST, commandToast, type ToastMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { BoardView, BotView, CardView, MemberView } from "@/lib/view";

export type Command =
	| { type: "create"; content: Record<string, unknown> }
	| { type: "edit"; cardId: string; patch: Record<string, unknown> }
	| { type: "move"; cardId: string; to: ParkColumn }
	| { type: "run"; cardId: string; bot: string | null }
	| { type: "cursor"; cardId: string }
	| { type: "stop"; cardId: string }
	| { type: "drop"; cardId: string; column: Column; index: number }
	| { type: "saveBot"; id: string | null; profile: Record<string, unknown> }
	| { type: "deleteBot"; id: string }
	| { type: "deleteCard"; cardId: string }
	| { type: "setOwnerAvatar"; avatar: string | null };

type Order = Record<Column, string[]>;
type DrawerTarget = { mode: "create" } | { mode: "edit"; cardId: string; dialog: boolean };

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
	const notify = useCallback((message: ToastMessage) => showToast(message), []);
	const offline = useRef(0);
	// A click on a card reads it in the side drawer; New card and Edit open the large dialog to write in.
	// The last target stays set after closing, so the drawer can animate out with its content.
	const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [drawerSerial, setDrawerSerial] = useState(0);
	const [botsOpen, setBotsOpen] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
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

	// Poll so bot edits show up without a reload.
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refresh();
		}, 15000);
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
	}, [refresh]);

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
			// Focus can still sit in a field of a drawer that is animating out; that field no longer takes typing.
			const leaving = target?.closest('[role="dialog"][data-state="closed"]');
			if (target && !leaving && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			// Shortcuts are for the board itself, not while a drawer, dialog, or menu is in front of it.
			// One that is only animating out no longer counts.
			if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]')) return;
			if (event.key === "n") {
				event.preventDefault();
				openDrawer({ mode: "create" });
			}
			if (event.key === "/") {
				event.preventDefault();
				document.getElementById("board-search")?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const openDrawer = useCallback((target: DrawerTarget) => {
		setDrawer(target);
		setDrawerOpen(true);
		// Each opening starts fresh, even for the card that was just closed.
		setDrawerSerial((serial) => serial + 1);
	}, []);
	const closeDrawer = useCallback(() => setDrawerOpen(false), []);

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
			const payload = (await response.json().catch(() => ({}))) as { board?: BoardView; notice?: string | null };
			if (payload.board) accept(payload.board);
			else if (!response.ok) await refresh();
			const message = commandToast(response.status, payload);
			if (message) notify(message);
			return response.ok;
		} catch {
			notify(UNREACHABLE_TOAST);
			await refresh();
			return false;
		}
	}

	const handlersFor = (card: CardView): CardHandlers => ({
		onOpen: () => {
			// The click that ends a drag is not a request to open the card.
			if (Date.now() - droppedAt.current > 250) openDrawer({ mode: "edit", cardId: card.id, dialog: false });
		},
		onEdit: () => openDrawer({ mode: "edit", cardId: card.id, dialog: true }),
		onDelete: () => askDelete(card),
		send,
		bots: board.bots,
		cursorEnabled: board.cursor.enabled,
	});

	function askDelete(card: CardView) {
		setConfirm({
			title: `Delete “${card.title}”?`,
			description: "The card and its notes are removed for good. Bots can no longer see it.",
			action: "Delete card",
			danger: true,
			onConfirm: async () => {
				const ok = await send({ type: "deleteCard", cardId: card.id });
				if (ok && drawer?.mode === "edit" && drawer.cardId === card.id) closeDrawer();
			},
		});
	}

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
		if (!from || !to || from === to || !card) return;
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
		if (!card || !to) {
			setOrder(orderOf(queued ?? board));
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
	const dialog = drawer?.mode === "create" || (drawer?.mode === "edit" && drawer.dialog);
	const shown = board.columns.reduce((sum, column) => sum + column.cards.filter(visible).length, 0);

	// The drawer for a card that was deleted elsewhere closes instead of turning into a blank new card.
	useEffect(() => {
		if (drawerOpen && drawer?.mode === "edit" && !cards.has(drawer.cardId)) {
			setDrawerOpen(false);
			notify({ text: "That card was deleted.", tone: "info" });
		}
	}, [cards, drawer, drawerOpen, notify]);

	return (
		<DndContext id="board" sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
			<div
				className={cn(
					"grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] [grid-template-areas:'top'_'dock'_'lanes']",
					"md:h-dvh md:min-h-0 md:grid-cols-[104px_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)] md:overflow-hidden md:[grid-template-areas:'top_top'_'dock_lanes']",
					activeCard && "select-none",
				)}
			>
				<header className="sticky top-0 z-10 flex flex-wrap items-center gap-2.5 border-b bg-deck-2 px-4 py-2.5 [grid-area:top] md:static md:flex-nowrap md:gap-3.5 md:px-5 md:py-3">
					<div className="flex flex-none items-center gap-1.5">
						{studioUrl ? (
							<a className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" href={studioUrl} aria-label="Back to the studio">
								<ChevronLeftIcon className="size-5" />
							</a>
						) : null}
						<h1 className="text-[15px] font-bold tracking-tight whitespace-nowrap">Grok Bot Kanban</h1>
					</div>
					<label className="relative order-3 flex basis-full items-center md:order-none md:max-w-[420px] md:flex-1 md:basis-auto">
						<span className="sr-only">Search cards</span>
						<SearchIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden="true" />
						<Input
							id="board-search"
							type="search"
							placeholder="Search cards"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape" && query) {
									event.preventDefault();
									setQuery("");
								}
							}}
							lang="ja"
							className="bg-background pr-9 pl-8 dark:bg-background [&::-webkit-search-cancel-button]:hidden"
						/>
						{query ? (
							<button
								type="button"
								className="absolute right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
								aria-label="Clear search"
								onClick={() => {
									setQuery("");
									document.getElementById("board-search")?.focus();
								}}
							>
								<XIcon className="size-3.5" />
							</button>
						) : (
							<Kbd className="absolute right-2 max-md:hidden">/</Kbd>
						)}
					</label>
					<Button className="ml-auto" onClick={() => openDrawer({ mode: "create" })} title="Shortcut: n">
						<PlusIcon />
						New card
					</Button>
					<ThemeMenu />
				</header>

				<nav
					aria-label="Team"
					className="flex min-h-0 items-center gap-1.5 overflow-x-auto border-b bg-deck-2 px-3 py-2 select-none [grid-area:dock] md:flex-col md:items-stretch md:overflow-hidden md:border-r md:border-b-0 md:px-2 md:py-3"
				>
					{/* Header and footer stay put; only the bots scroll between them. */}
					<div className="flex flex-none items-center gap-1 md:grid md:border-b md:pb-2">
						<p className={cn("mx-1 mb-0.5 text-center text-[11px] whitespace-nowrap text-muted-foreground max-md:hidden", activeCard && "text-primary")}>{activeCard ? "Drop to assign" : "Team"}</p>
						<DockMember member={owner} load={ownerLoad} active={memberFilter === OWNER.id} onClick={() => setMemberFilter((current) => (current === OWNER.id ? null : OWNER.id))} droppable={Boolean(activeCard)} />
					</div>
					<div className="flex flex-none gap-1 md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto md:overscroll-contain md:py-0.5 md:[scrollbar-width:thin]">
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
						{board.bots.length === 0 ? (
							<button type="button" className="mx-1 my-2 rounded-md text-center text-[11px] text-faint hover:text-foreground max-md:hidden" onClick={() => setBotsOpen(true)}>
								No bots yet. Connect one
							</button>
						) : null}
					</div>
					<div className="ml-auto flex flex-none items-center gap-1 md:ml-0 md:grid md:border-t md:pt-2">
						<DockButton active={memberFilter === "none"} onClick={() => setMemberFilter((current) => (current === "none" ? null : "none"))} title="Open cards with no assignee" load={unassigned} label="Unassigned">
							<span className="size-10 rounded-full border-2 border-dashed border-faint" />
						</DockButton>
						<Button variant="outline" size="sm" className="text-xs md:h-auto md:w-full md:px-1 md:py-1.5 md:whitespace-normal" onClick={() => setBotsOpen(true)}>
							<SettingsIcon className="md:hidden" />
							Bots & MCP
						</Button>
						<form method="post" action="/api/auth/logout" className="m-0">
							<Button type="submit" variant="ghost" size="sm" className="text-xs text-muted-foreground md:w-full">
								<LogOutIcon className="md:hidden" />
								Sign out
							</Button>
						</form>
					</div>
				</nav>

				<main className="flex min-h-0 flex-col [grid-area:lanes]">
					{filtering ? (
						// What the board is filtered by, each with its own ×, and Clear all beside them, aligned with the columns.
						<div className="flex flex-wrap items-center gap-2 px-4 pt-3 md:px-5 md:pt-4" role="status" aria-label="Filters">
							<span className="mr-1 text-[13px] text-muted-foreground">
								<strong className="font-bold text-foreground">{shown}</strong> of {cards.size} {cards.size === 1 ? "card" : "cards"}
							</span>
							{needle ? (
								<FilterChip label="Search" value={query.trim()} onClear={() => setQuery("")} />
							) : null}
							{memberFilter ? (
								<FilterChip
									label={memberFilter === "none" ? "Assignee" : "Member"}
									value={memberFilter === "none" ? "Unassigned" : memberFilter === OWNER.id ? "You" : (board.bots.find((bot) => bot.id === memberFilter)?.name ?? memberFilter)}
									onClear={() => setMemberFilter(null)}
								/>
							) : null}
							{needle && memberFilter ? (
								<Button
									variant="ghost"
									size="xs"
									className="text-muted-foreground hover:text-foreground"
									onClick={() => {
										setQuery("");
										setMemberFilter(null);
									}}
								>
									Clear all
								</Button>
							) : null}
						</div>
					) : null}
					<div className={cn("flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 items-stretch gap-3 overflow-x-auto px-4 pt-3 pb-5 md:snap-none md:gap-3.5 md:p-5", filtering && "md:pt-3")}>
						{board.columns.map((column) => {
							const ids = (order[column.id] ?? []).filter((id) => cards.has(id) && visible(cards.get(id)!));
							const isFolded = folded.includes(column.id);
							return (
								<ColumnShell
									key={column.id}
									id={column.id}
									label={column.label}
									count={filtering ? ids.length : (order[column.id] ?? []).length}
									canDrop={Boolean(activeCard)}
									folded={isFolded}
									onFold={FOLDABLE.includes(column.id) ? () => toggleFold(column.id) : null}
									onAdd={column.id === "inbox" ? () => setQuickAdd(true) : null}
								>
									{column.id === "inbox" && quickAdd ? (
										<QuickAdd onCancel={() => setQuickAdd(false)} onAdd={async (title) => send({ type: "create", content: { title } })} />
									) : null}
									{isFolded ? null : (
										<SortableContext items={ids} strategy={verticalListSortingStrategy}>
											{ids.length === 0 ? (
												<p className="rounded-lg border border-dashed px-3 py-[18px] text-center text-xs text-faint">{filtering ? "No matching cards" : emptyText(column.id)}</p>
											) : null}
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

				<DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
					{activeCard ? <CardPanel card={activeCard} handlers={handlersFor(activeCard)} overlay toMember={overMember} /> : null}
				</DragOverlay>

				{drawer ? (
					<CardDrawer
						key={drawerSerial}
						open={drawerOpen}
						card={editing}
						dialog={dialog}
						cursorEnabled={board.cursor.enabled}
						members={members}
						onClose={closeDrawer}
						onDelete={askDelete}
						send={send}
						notify={notify}
						onSubmit={async (payload) => {
							const ok = editing ? await send({ type: "edit", cardId: editing.id, patch: payload }) : await send({ type: "create", content: payload });
							if (ok) closeDrawer();
							return ok;
						}}
					/>
				) : null}
				<BotsPanel open={botsOpen} bots={board.bots} owner={owner} onClose={() => setBotsOpen(false)} send={send} notify={notify} />
				<ConfirmDialog request={confirm} onDone={() => setConfirm(null)} />
				<Toasts />
			</div>
		</DndContext>
	);
}

/** One face in the dock: filter by it with a click, or drop a card on it to assign that member. */
function DockMember({ member, load, active, onClick, droppable }: { member: MemberView | BotView; load: number; active: boolean; onClick: () => void; droppable: boolean }) {
	const { setNodeRef, isOver } = useDroppable({ id: `${MEMBER_DROP}${member.id}`, disabled: !droppable, data: { pinpoint: true } });
	const bot = "role" in member ? member : null;
	const title = bot ? [bot.name, bot.role, bot.lastSeen === null ? "Not seen yet" : bot.lastSeen === "just now" ? "Seen just now" : `Last seen ${bot.lastSeen} ago`].filter(Boolean).join("\n") : "You";
	return (
		<DockButton ref={setNodeRef} active={active} over={isOver} waiting={droppable} onClick={onClick} title={title} load={load} label={member.name} color={member.color}>
			<MemberAvatar member={member} size={32} />
		</DockButton>
	);
}

function DockButton({
	ref,
	active,
	over = false,
	waiting = false,
	onClick,
	title,
	load,
	label,
	color,
	children,
}: {
	ref?: (node: HTMLElement | null) => void;
	active: boolean;
	over?: boolean;
	/** A card is being dragged, so every face shows it takes a drop. */
	waiting?: boolean;
	onClick: () => void;
	title: string;
	load: number;
	label: string;
	color?: string;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					ref={ref}
					type="button"
					aria-pressed={active}
					onClick={onClick}
					aria-label={`${label}, ${load} ${load === 1 ? "card" : "cards"}`}
					style={{ "--member": color ?? "var(--primary)" } as React.CSSProperties}
					className={cn(
						"group/dock relative grid w-[72px] flex-none cursor-pointer justify-items-center gap-1 rounded-md border border-transparent px-1 pt-2 pb-1.5 text-foreground transition-colors hover:bg-deck md:w-auto md:min-w-0",
						(active || over) && "border-(--member) bg-deck",
					)}
				>
					<span
						className={cn(
							"grid size-9 place-items-center rounded-full transition-[box-shadow,transform] duration-150 [&>*]:shadow-[0_0_0_2px_var(--deck-2)]",
							active && "[&>*]:shadow-[0_0_0_2px_var(--deck-2),0_0_0_4px_var(--member)]",
							waiting && !active && "[&>*]:shadow-[0_0_0_2px_var(--deck-2),0_0_0_4px_var(--line)]",
							over && "scale-110 [&>*]:shadow-[0_0_0_2px_var(--deck-2),0_0_0_4px_var(--member),0_0_22px_var(--member)]",
						)}
					>
						{children}
					</span>
					<span className={cn("max-w-[84px] truncate text-[11px] text-muted-foreground group-hover/dock:text-foreground", active && "text-foreground")} lang="ja">
						{label}
					</span>
					<span className="absolute top-1 right-3 grid h-5 min-w-5 place-items-center rounded-full border border-line bg-background px-1 font-display text-[11px] font-semibold" aria-hidden="true">
						{load}
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent side="right" className="whitespace-pre-line" lang="ja">
				{title}
			</TooltipContent>
		</Tooltip>
	);
}

function ColumnShell({
	id,
	label,
	count,
	canDrop,
	folded,
	onFold,
	onAdd,
	children,
}: {
	id: Column;
	label: string;
	count: number;
	canDrop: boolean;
	folded: boolean;
	onFold: (() => void) | null;
	onAdd: (() => void) | null;
	children: React.ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `column:${id}`, data: { pinpoint: folded } });
	return (
		<section
			ref={setNodeRef}
			data-column={id}
			aria-label={label}
			className={cn(
				"flex min-h-0 flex-col rounded-b-md border border-t-[3px] border-t-(--lamp) bg-deck-2 transition-colors [--surface:var(--deck-2)]",
				"max-h-[calc(100dvh-220px)] flex-[0_0_calc(100vw-48px)] snap-start md:max-h-none md:max-w-[360px] md:min-w-[232px] md:flex-[1_1_232px]",
				folded && "max-w-[52px] min-w-[52px] flex-[0_0_52px] md:max-w-[52px] md:min-w-[52px] md:flex-[0_0_52px]",
				canDrop && "border-line",
				canDrop && isOver && "border-primary border-t-(--lamp) bg-drop",
			)}
		>
			<header className={cn("flex h-10 flex-none items-center gap-2 pr-1.5 pl-3 select-none", folded && "h-auto flex-col gap-2.5 px-0 py-3")}>
				{onFold && folded ? <FoldButton label={label} folded onClick={onFold} /> : null}
				<h2 className={cn("text-[13px] font-bold whitespace-nowrap", folded && "text-sm [writing-mode:vertical-rl]")}>{label}</h2>
				<span className="text-xs font-medium text-muted-foreground tabular-nums">{count}</span>
				{onAdd || (onFold && !folded) ? (
					<span className="ml-auto flex items-center">
						{onAdd ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="ghost" size="icon-sm" aria-label="Add a card to Inbox" className="text-muted-foreground hover:text-foreground" onClick={onAdd}>
										<PlusIcon />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Add a card</TooltipContent>
							</Tooltip>
						) : null}
						{onFold && !folded ? <FoldButton label={label} folded={false} onClick={onFold} /> : null}
					</span>
				) : null}
			</header>
			<div className={cn("flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2", folded && "min-h-0 p-0")}>{children}</div>
		</section>
	);
}

/** One active filter, such as Search "ログ", with an × that removes just that filter. */
function FilterChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
	return (
		<span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-line bg-secondary pr-1 pl-2.5 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<span className="max-w-[16rem] truncate font-bold" lang="ja">
				{value}
			</span>
			<button type="button" className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-line hover:text-foreground" aria-label={`Remove the ${label.toLowerCase()} filter`} onClick={onClear}>
				<XIcon className="size-3" />
			</button>
		</span>
	);
}

function FoldButton({ label, folded, onClick }: { label: string; folded: boolean; onClick: () => void }) {
	return (
		<Button variant="ghost" size="icon-sm" aria-label={folded ? `Show ${label}` : `Fold ${label}`} aria-expanded={!folded} className="text-muted-foreground hover:text-foreground" onClick={onClick}>
			{folded ? <ChevronRightIcon /> : <ChevronLeftIcon />}
		</Button>
	);
}

function QuickAdd({ onAdd, onCancel }: { onAdd: (title: string) => Promise<boolean>; onCancel: () => void }) {
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);
	useEffect(() => {
		if (!busy) input.current?.focus();
	}, [busy]);
	return (
		<form
			className="flex items-center gap-1.5"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!title.trim()) return;
				setBusy(true);
				const ok = await onAdd(title.trim());
				setBusy(false);
				if (ok) setTitle("");
			}}
		>
			<Input
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
				className="border-primary bg-background dark:bg-background"
			/>
			<Button type="button" variant="ghost" size="icon-sm" aria-label="Stop adding cards" onClick={onCancel}>
				<XIcon />
			</Button>
		</form>
	);
}

function SortableCard({ card, handlers, highlighted }: { card: CardView; handlers: CardHandlers; highlighted: boolean }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
	return (
		<CardPanel
			ref={setNodeRef}
			card={card}
			handlers={handlers}
			dragging={isDragging}
			highlighted={highlighted}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className="active:cursor-grabbing"
			{...attributes}
			{...listeners}
			aria-roledescription="draggable card"
			aria-label={card.title || "Untitled"}
		/>
	);
}

function emptyText(column: Column): string {
	if (column === "inbox") return "New requests from bots land here";
	if (column === "todo") return "Cards ready to work on";
	if (column === "inProgress") return "Nothing in progress";
	if (column === "inReview") return "Cards waiting for review";
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

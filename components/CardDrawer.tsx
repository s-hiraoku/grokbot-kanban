"use client";

import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, Maximize2Icon, Minimize2Icon, SquareTerminalIcon, Trash2Icon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Fragment, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Menu, MenuItem, MenuTitle } from "@/components/ActionMenu";
import AssigneePicker from "@/components/AssigneePicker";
import { MemberAvatar } from "@/components/Avatar";
import { CreatedAt } from "@/components/CreatedAt";
import type { Command } from "@/components/Board";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { RunControl } from "@/components/RunControl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COLUMNS, type Column } from "@/lib/domain";
import type { ToastMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { CardView, MemberView } from "@/lib/view";

const PRIORITIES = [
	{ id: "low", label: "Low" },
	{ id: "normal", label: "Normal" },
	{ id: "high", label: "High" },
] as const;

/**
 * Reads, edits, and moves one card, or writes a new one. It opens as a side drawer to read a card, or as a
 * large centered dialog to write in; the expand button switches between the two while it is open. Closing
 * with unsaved changes asks first.
 */
export default function CardDrawer({
	open,
	card,
	dialog = false,
	members,
	cursorEnabled = false,
	send,
	notify,
	onSubmit,
	onDelete,
	onClose,
}: {
	open: boolean;
	card: CardView | null;
	/** Opens as the large centered dialog instead of the side drawer, with the details ready to edit. */
	dialog?: boolean;
	members: readonly MemberView[];
	/** Whether Run can hand the card to a Cursor agent. */
	cursorEnabled?: boolean;
	send: (command: Command) => Promise<boolean>;
	notify: (message: ToastMessage) => void;
	onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
	/** Asks to delete the card; the board confirms first. */
	onDelete: (card: CardView) => void;
	onClose: () => void;
}) {
	const [title, setTitle] = useState(card?.title ?? "");
	const [body, setBody] = useState(card?.body ?? "");
	const [repo, setRepo] = useState(card?.repo?.url ?? "");
	const [ref, setRef] = useState(card?.repo?.startingRef ?? "main");
	const [source, setSource] = useState(card?.source ?? "");
	const [originalLink, setOriginalLink] = useState(card?.originalLink ?? "");
	const [notes, setNotes] = useState(card?.notes ?? "");
	const [priority, setPriority] = useState(card?.priority ?? "normal");
	const [kind, setKind] = useState<string>(card?.kind.type ?? "text");
	const [seconds, setSeconds] = useState(card?.kind.type === "voice" ? String(card.kind.seconds) : "6");
	const [assignees, setAssignees] = useState<string[]>(card?.assignees.map((member) => member.id) ?? []);
	const [screened, setScreened] = useState(card?.screened ?? false);
	const [reviewer, setReviewer] = useState(card?.reviewer === "grok" ? "grok" : "owner");
	// Existing text opens as reading copy; a new card, or a card with nothing written yet, opens for typing.
	const [editingBody, setEditingBody] = useState(dialog || !card?.body);
	const [editingNotes, setEditingNotes] = useState(false);
	const [wide, setWide] = useState(dialog);
	const [moreOpen, setMoreOpen] = useState(!card || dialog);
	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
	const first = useRef<HTMLTextAreaElement>(null);
	const panel = useRef<HTMLFormElement>(null);

	const content = () => ({
		title: title.trim(),
		body,
		notes,
		source: source.trim() || null,
		originalLink: originalLink.trim() || null,
		priority,
		repo: repo.trim() ? { url: repo.trim(), startingRef: ref.trim() || "main" } : null,
		kind: kind === "voice" ? { type: "voice", seconds: Math.max(1, Math.round(Number(seconds) || 1)) } : { type: "text" },
		assignees,
		screening: screened ? { by: reviewer } : null,
	});

	const changes = () => {
		const next = content();
		if (!card) return next;
		const patch: Record<string, unknown> = {};
		if (next.title !== card.title) patch.title = next.title;
		if (next.body !== card.body) patch.body = next.body;
		if (next.notes !== card.notes) patch.notes = next.notes;
		if (next.source !== card.source) patch.source = next.source;
		if (next.originalLink !== card.originalLink) patch.originalLink = next.originalLink;
		if (next.priority !== card.priority) patch.priority = next.priority;
		if (JSON.stringify(next.repo) !== JSON.stringify(card.repo)) patch.repo = next.repo;
		if (JSON.stringify(next.kind) !== JSON.stringify(card.kind)) patch.kind = next.kind;
		if (next.assignees.join() !== card.assignees.map((member) => member.id).join()) patch.assignees = next.assignees;
		if (screened !== card.screened || (screened && reviewer !== (card.reviewer === "grok" ? "grok" : "owner"))) patch.screening = next.screening;
		return patch;
	};
	const dirty = card ? Object.keys(changes()).length > 0 : title.trim().length > 0 || body.trim().length > 0;

	// Escape, a click outside, and × all come here, so nothing typed is lost without asking.
	const requestClose = () => {
		if (busy) return;
		if (!dirty) {
			onClose();
			return;
		}
		setConfirm({
			title: card ? "Discard your changes?" : "Discard this new card?",
			description: card ? "The edits you made to this card have not been saved." : "What you typed will be lost.",
			action: "Discard",
			danger: true,
			onConfirm: onClose,
		});
	};

	const copyLink = async () => {
		if (!card) return;
		const url = `${window.location.origin}/?card=${card.id}`;
		try {
			await navigator.clipboard.writeText(url);
			notify({ text: "Link copied", tone: "success" });
		} catch {
			notify({ text: `Could not copy. The link is ${url}`, tone: "warning" });
		}
	};

	const label = card ? `Card ${card.title}` : "New card";

	return (
		<DialogPrimitive.Root open={open} onOpenChange={(next) => !next && requestClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					className={cn(
						"fixed inset-0 z-40 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
						wide ? "bg-scrim-strong" : "bg-scrim",
					)}
				/>
				<DialogPrimitive.Content
					aria-describedby={undefined}
					data-slot="card-drawer"
					data-wide={wide}
					className={cn(
						"fixed z-40 flex flex-col overflow-hidden bg-deck shadow-2xl outline-none [--surface:var(--deck)] duration-200",
						// While it animates out it lets clicks through, so the board answers at once.
						"data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
						wide
							? "inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:h-[min(900px,94dvh)] md:w-[min(1120px,94vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-line data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]"
							: "inset-y-0 right-0 w-full border-line md:w-[520px] md:border-l data-[state=closed]:slide-out-to-right-8 data-[state=open]:slide-in-from-right-8",
					)}
					onCloseAutoFocus={(event) => {
						// When the next drawer opened while this one was leaving, focus stays with the new one.
						if (document.querySelector('[data-slot="card-drawer"][data-state="open"]')) event.preventDefault();
					}}
					onOpenAutoFocus={(event) => {
						// A new card starts in its title; an existing one takes focus itself, so Escape and Tab work at once.
						event.preventDefault();
						if (card) panel.current?.focus();
						else first.current?.focus();
					}}
				>
					<DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
					<form
						ref={panel}
						tabIndex={-1}
						aria-label={label}
						className="flex min-h-0 flex-1 flex-col outline-none"
						onKeyDown={(event) => {
							// Cmd or Ctrl + Enter saves from any field.
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								event.currentTarget.requestSubmit();
							}
						}}
						onSubmit={async (event) => {
							event.preventDefault();
							if (!dirty) {
								onClose();
								return;
							}
							if (!title.trim()) {
								first.current?.focus();
								return;
							}
							setBusy(true);
							await onSubmit(changes());
							setBusy(false);
						}}
					>
						<header className="flex flex-wrap items-center gap-2.5 border-b px-3.5 py-3">
							{card ? (
								<StatusMenu column={card.column} onMove={(to) => void send({ type: "move", cardId: card.id, to })} />
							) : (
								<span data-column="inbox" className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-[color-mix(in_srgb,var(--lamp)_12%,transparent)] px-3 font-display text-[13px] font-semibold">
									<Lamp />
									New card for Inbox
								</span>
							)}
							{card ? <RunControl card={card} bots={members.filter((member) => member.kind === "bot")} cursorEnabled={cursorEnabled} size="drawer" send={send} /> : null}
							{card ? <span className="font-display text-xs text-faint">#{card.shortId}</span> : null}
							<span className="ml-auto inline-flex items-center gap-0.5">
								<IconButton label={wide ? "Show as side panel" : "Open in a large view"} aria-pressed={wide} onClick={() => setWide((current) => !current)} className="max-md:hidden">
									{wide ? <Minimize2Icon /> : <Maximize2Icon />}
								</IconButton>
								{card ? (
									<>
										<IconButton label="Copy link" onClick={() => void copyLink()}>
											<CopyIcon />
										</IconButton>
										<IconButton label="Delete card" onClick={() => onDelete(card)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
											<Trash2Icon />
										</IconButton>
									</>
								) : null}
								<IconButton label="Close" onClick={requestClose}>
									<XIcon />
								</IconButton>
							</span>
						</header>

						<div className={cn("min-h-0 flex-1 overflow-y-auto", wide && "md:grid md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden")}>
							<div className={cn("flex min-w-0 flex-col gap-5 px-5 pt-5 pb-2", wide && "md:overflow-y-auto md:px-10 md:pt-7 md:pb-8")}>
								<div>
									<label className="block">
										<span className="sr-only">Title</span>
										<GrowingText
											inputRef={first}
											value={title}
											onChange={setTitle}
											required
											maxLength={200}
											placeholder="What needs doing?"
											onEnter={() => panel.current?.requestSubmit()}
											className={cn(
												"-ml-2 min-h-0 border-transparent bg-transparent px-2 py-1 font-bold shadow-none break-words hover:border-border focus-visible:bg-background dark:bg-transparent",
												wide ? "text-[19px] leading-[1.45] md:text-[23px] md:leading-[1.4]" : "text-[19px] leading-[1.45]",
											)}
										/>
									</label>
									{card ? (
										<p className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
											{card.createdBy ? <MemberAvatar member={card.createdBy} size={20} /> : null}
											<span>
												Filed by {card.createdBy?.name ?? "the API"}, <CreatedAt iso={card.createdAt} age={card.age} phrase />
											</span>
										</p>
									) : null}
								</div>
								{card?.run ? (
									<p
										className={cn(
											"flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed",
											card.run.status === "working" ? "bg-teal-soft text-teal-text" : "bg-amber-soft text-amber-text",
										)}
										role="status"
									>
										<MemberAvatar member={card.run.bot} size={22} />
										<span lang="ja">
											{card.run.status === "working"
												? `${card.run.bot.name} is working on this card (started ${card.run.since === "just now" ? "just now" : `${card.run.since} ago`}). Its report lands in Notes.`
												: `Waiting for ${card.run.bot.name} to pick this up (asked ${card.run.since === "just now" ? "just now" : `${card.run.since} ago`}). The Bot checks on its routine.`}
										</span>
									</p>
								) : null}
								{card?.cursor ? (
									<p
										className={cn(
											"flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed",
											card.cursor.status === "running" ? "bg-teal-soft text-teal-text" : "bg-amber-soft text-amber-text",
										)}
										role="status"
									>
										<SquareTerminalIcon className="mt-0.5 size-4 flex-none" aria-hidden="true" />
										<span>
											{card.cursor.status === "running"
												? `A Cursor agent is working on ${card.repoLabel ?? "the repository"} (started ${card.cursor.since === "just now" ? "just now" : `${card.cursor.since} ago`} by ${card.cursor.by.name}). The card moves to In Review when its pull request is ready.`
												: "Handed to Cursor. Waiting for Cursor to confirm the agent."}{" "}
											{card.cursor.agentUrl ? (
												<a href={card.cursor.agentUrl} target="_blank" rel="noreferrer" className="font-bold text-inherit underline">
													Open in Cursor
												</a>
											) : null}
										</span>
									</p>
								) : null}

								<TextBlock
									title="Details"
									action={
										body ? (
											<Button type="button" variant="ghost" size="xs" onClick={() => setEditingBody((current) => !current)}>
												{editingBody ? "Preview" : "Edit"}
											</Button>
										) : null
									}
								>
									{editingBody ? (
										<GrowingText
											value={body}
											onChange={setBody}
											minRows={wide ? 18 : 12}
											placeholder="What the bot reported, steps, context"
											autoFocus={Boolean(card)}
											aria-label="Details"
											className={cn("bg-background px-3.5 py-3 text-[13.5px] leading-[1.8] dark:bg-background", wide ? "min-h-[420px]" : "min-h-[260px]")}
										/>
									) : (
										<div className={cn("prose-card cursor-text", wide ? "min-h-[420px] md:max-w-[72ch] md:text-[14.5px]" : "min-h-[260px]")} lang="ja" onDoubleClick={() => setEditingBody(true)}>
											<Prose text={body} />
										</div>
									)}
								</TextBlock>

								<TextBlock
									title="Notes"
									action={
										!editingNotes ? (
											<Button type="button" variant="ghost" size="xs" onClick={() => setEditingNotes(true)}>
												{notes ? "Edit" : "Add note"}
											</Button>
										) : null
									}
								>
									{editingNotes ? (
										<GrowingText value={notes} onChange={setNotes} minRows={5} placeholder="Bots sign their notes here" autoFocus aria-label="Notes" className="bg-background px-3.5 py-3 text-[13px] leading-[1.7] dark:bg-background" />
									) : notes ? (
										<NotesLog notes={notes} />
									) : (
										<p className="text-[13px] text-muted-foreground">No notes yet.</p>
									)}
								</TextBlock>
							</div>

							<aside
								aria-label="Card fields"
								className={cn("flex min-w-0 flex-col gap-5 border-t px-5 pt-5 pb-6", wide && "md:overflow-y-auto md:border-t-0 md:border-l md:bg-deck-2 md:px-5.5 md:pt-6 md:[--surface:var(--deck-2)]")}
							>
								<div className="grid gap-2">
									<AssigneePicker members={members} selected={assignees} onChange={setAssignees} />
									{members.length <= 1 ? <p className="text-xs text-muted-foreground">Bots appear here once they use the board, or add one under Bots & MCP.</p> : null}
								</div>

								<div className="grid gap-2">
									<FieldLabel id="priority-label">Priority</FieldLabel>
									<ToggleGroup
										type="single"
										variant="outline"
										size="sm"
										aria-labelledby="priority-label"
										value={priority}
										onValueChange={(value) => value && setPriority(value)}
									>
										{PRIORITIES.map((item) => (
											<ToggleGroupItem
												key={item.id}
												value={item.id}
												className={cn("px-3.5 data-[state=on]:font-bold", item.id === "high" && "data-[state=on]:bg-danger-soft data-[state=on]:text-danger-text")}
											>
												{item.label}
											</ToggleGroupItem>
										))}
									</ToggleGroup>
								</div>

								{card && (card.links.pr || card.links.agent || card.originalLink) ? (
									<div className="grid gap-2">
										<FieldLabel>Links</FieldLabel>
										<ul className="grid gap-1.5 text-[13px] [&_a]:text-link">
											{card.links.pr ? (
												<li>
													<a href={card.links.pr} target="_blank" rel="noreferrer">
														Pull request
													</a>
												</li>
											) : null}
											{card.originalLink ? (
												<li>
													<a href={card.originalLink} target="_blank" rel="noreferrer">
														Original post
													</a>
												</li>
											) : null}
											{card.links.agent ? (
												<li>
													<a href={card.links.agent} target="_blank" rel="noreferrer">
														{card.cursor ? "Cursor agent" : "Last Cursor agent"}
													</a>
												</li>
											) : null}
										</ul>
									</div>
								) : null}

								<Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
									<CollapsibleTrigger className="flex items-center gap-1.5 rounded-sm text-xs font-bold text-muted-foreground hover:text-foreground">
										<ChevronRightIcon className={cn("size-3.5 transition-transform", moreOpen && "rotate-90")} />
										More fields
									</CollapsibleTrigger>
									<CollapsibleContent className="-mx-1 overflow-hidden px-1 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
										<div className="grid gap-3 pt-3 pb-1">
											<div className={cn("grid grid-cols-1 gap-3", !wide && "sm:grid-cols-2")}>
												<Field label="Repo" className={cn(!wide && "sm:col-span-2")}>
													<Input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/org/repo" inputMode="url" />
												</Field>
												<Field label="Branch">
													<Input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="main" />
												</Field>
												<Field label="Source">
													<Input value={source} onChange={(event) => setSource(event.target.value)} placeholder="x, slack" />
												</Field>
												<Field label="Original post" className={cn(!wide && "sm:col-span-2")}>
													<Input value={originalLink} onChange={(event) => setOriginalLink(event.target.value)} placeholder="https://" inputMode="url" />
												</Field>
												<div className="grid gap-1.5">
													<FieldLabel id="kind-label">Kind</FieldLabel>
													<Select value={kind} onValueChange={setKind}>
														<SelectTrigger aria-labelledby="kind-label" className="w-full">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="text">Text</SelectItem>
															<SelectItem value="voice">Voice</SelectItem>
														</SelectContent>
													</Select>
												</div>
												{kind === "voice" ? (
													<Field label="Seconds">
														<Input value={seconds} onChange={(event) => setSeconds(event.target.value)} inputMode="numeric" />
													</Field>
												) : null}
											</div>
											<div className="flex flex-wrap items-center gap-2.5 text-[13px]">
												<Label className="cursor-pointer gap-2 text-[13px] font-normal">
													<Checkbox checked={screened} onCheckedChange={(value) => setScreened(value === true)} />
													Screened for moderation
												</Label>
												{screened ? (
													<Select value={reviewer} onValueChange={setReviewer}>
														<SelectTrigger size="sm" aria-label="Screened by">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="owner">by you</SelectItem>
															<SelectItem value="grok">by Grok</SelectItem>
														</SelectContent>
													</Select>
												) : null}
											</div>
										</div>
									</CollapsibleContent>
								</Collapsible>
							</aside>
						</div>

						<footer className="flex flex-wrap items-center gap-2 border-t bg-deck-2 px-4 py-3">
							<span className="text-xs text-muted-foreground">
								{card && !dirty ? (
									"No unsaved changes"
								) : (
									<>
										{card ? "Unsaved changes" : "Lands in Inbox"} · <Kbd>⌘</Kbd>
										<Kbd>Enter</Kbd> to save
									</>
								)}
							</span>
							<span className="ml-auto inline-flex gap-2">
								<Button type="button" variant="outline" onClick={requestClose} disabled={busy}>
									{card && !dirty ? "Close" : "Cancel"}
								</Button>
								<Button type="submit" disabled={busy || !title.trim() || (card !== null && !dirty)}>
									{busy ? <Spinner /> : null}
									{card ? "Save changes" : "Add to Inbox"}
								</Button>
							</span>
						</footer>
					</form>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
			<ConfirmDialog request={confirm} onDone={() => setConfirm(null)} />
		</DialogPrimitive.Root>
	);
}

function IconButton({ label, className, children, ...props }: { label: string } & ComponentProps<"button">) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button type="button" variant="ghost" size="icon-sm" aria-label={label} className={cn("text-muted-foreground hover:text-foreground", className)} {...props}>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function Lamp({ className }: { className?: string }) {
	return <span aria-hidden="true" className={cn("size-2 flex-none rounded-full bg-(--lamp)", className)} />;
}

function FieldLabel({ id, children }: { id?: string; children: ReactNode }) {
	return (
		<p id={id} className="text-xs font-bold text-muted-foreground">
			{children}
		</p>
	);
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
	return (
		<label className={cn("grid min-w-0 gap-1.5", className)}>
			<span className="text-xs font-bold text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

function TextBlock({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
	return (
		<section className="grid gap-2.5" aria-label={title}>
			<div className="flex min-h-7 items-center justify-between gap-2 border-b pb-1.5">
				<h3 className="text-[13px] font-bold text-foreground">{title}</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

/** The card's column as a button that opens a menu of the other columns, like an issue's status. */
function StatusMenu({ column, onMove }: { column: Column; onMove: (to: Column) => void }) {
	const label = COLUMNS.find((item) => item.id === column)?.label ?? column;
	return (
		<Menu
			align="start"
			trigger={
				<button
					type="button"
					data-column={column}
					className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-[color-mix(in_srgb,var(--lamp)_12%,transparent)] pr-2.5 pl-3 font-display text-[13px] font-semibold transition-colors hover:border-(--lamp) data-[state=open]:border-(--lamp)"
					aria-label={`Status: ${label}. Move to another column`}
				>
					<Lamp />
					<span>{label}</span>
					<ChevronDownIcon className="size-3.5 text-muted-foreground" />
				</button>
			}
		>
			<MenuTitle>Move to</MenuTitle>
			{COLUMNS.map((item) => (
				<MenuItem key={item.id} current={item.id === column} onSelect={() => item.id !== column && onMove(item.id)} data-column={item.id}>
					<Lamp />
					{item.label}
					{item.id === column ? <CheckIcon className="ml-auto text-primary" aria-hidden="true" /> : null}
				</MenuItem>
			))}
		</Menu>
	);
}

/** A textarea that grows with its text, so long titles and details never hide behind a scrollbar. */
function GrowingText({
	value,
	onChange,
	inputRef,
	className,
	minRows = 1,
	onEnter,
	...rest
}: {
	value: string;
	onChange: (value: string) => void;
	inputRef?: RefObject<HTMLTextAreaElement | null>;
	className?: string;
	minRows?: number;
	/** When set, Enter calls it instead of adding a line, as a title field should. */
	onEnter?: () => void;
	required?: boolean;
	maxLength?: number;
	placeholder?: string;
	autoFocus?: boolean;
	"aria-label"?: string;
}) {
	const own = useRef<HTMLTextAreaElement>(null);
	const node = inputRef ?? own;
	useLayoutEffect(() => {
		const element = node.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${element.scrollHeight + 2}px`;
	}, [value, node]);
	return (
		<Textarea
			ref={node}
			className={cn("[field-sizing:fixed] resize-none overflow-hidden", className)}
			value={value}
			rows={minRows}
			lang="ja"
			onChange={(event) => onChange(onEnter ? event.target.value.replace(/\n/g, " ") : event.target.value)}
			onKeyDown={(event) => {
				if (onEnter && event.key === "Enter" && !event.nativeEvent.isComposing && !event.metaKey && !event.ctrlKey) {
					event.preventDefault();
					onEnter();
				}
			}}
			{...rest}
		/>
	);
}

/**
 * Card text as reading copy: blank lines split paragraphs, "#" lines become headings, runs of "-" lines
 * become lists, and URLs become links. Everything else stays as written, line breaks included.
 */
function Prose({ text }: { text: string }) {
	if (!text.trim()) return <p className="text-muted-foreground">No details yet. Double-click or press Edit to add them.</p>;
	const out: ReactNode[] = [];
	let lines: string[] = [];
	let items: string[] = [];
	const flush = () => {
		if (lines.length) {
			const kept = lines;
			out.push(
				<p key={out.length}>
					{kept.map((line, at) => (
						<Fragment key={at}>
							{at > 0 ? <br /> : null}
							{linkify(line)}
						</Fragment>
					))}
				</p>,
			);
		}
		if (items.length) {
			out.push(
				<ul key={out.length}>
					{items.map((item, at) => (
						<li key={at}>{linkify(item)}</li>
					))}
				</ul>,
			);
		}
		lines = [];
		items = [];
	};
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		const item = /^\s*[-*・]\s+(.*)$/.exec(line);
		if (!line.trim()) flush();
		else if (heading) {
			flush();
			out.push(<h4 key={out.length}>{linkify(heading[1] ?? "")}</h4>);
		} else if (item) {
			if (lines.length) flush();
			items.push(item[1] ?? "");
		} else {
			if (items.length) flush();
			lines.push(line);
		}
	}
	flush();
	return <>{out}</>;
}

/** Notes as a log. Lines signed "[YYYY-MM-DD HH:MM Name]" become entries; other lines join the entry above. */
function NotesLog({ notes }: { notes: string }) {
	const entries: { stamp: string | null; author: string | null; lines: string[] }[] = [];
	for (const line of notes.split("\n")) {
		const signed = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) ([^\]]+)\]\s?(.*)$/.exec(line);
		if (signed) entries.push({ stamp: signed[1] ?? null, author: signed[2] ?? null, lines: [signed[3] ?? ""] });
		else if (entries.length) entries[entries.length - 1]?.lines.push(line);
		else entries.push({ stamp: null, author: null, lines: [line] });
	}
	return (
		<ol className="grid gap-3 border-l-2 pl-3.5" lang="ja">
			{entries.map((entry, index) => (
				<li key={index} className="relative before:absolute before:top-[7px] before:-left-[19px] before:size-2 before:rounded-full before:bg-line">
					{entry.author ? (
						<p className="mb-0.5 flex items-baseline gap-2 text-xs">
							<strong>{entry.author}</strong>
							<time className="font-display text-faint">{entry.stamp}</time>
						</p>
					) : null}
					<p className="text-[13px] leading-[1.7] break-words text-soft-text [&_a]:text-link">
						{entry.lines.map((line, at) => (
							<Fragment key={at}>
								{at > 0 ? <br /> : null}
								{linkify(line)}
							</Fragment>
						))}
					</p>
				</li>
			))}
		</ol>
	);
}

function linkify(line: string): ReactNode[] {
	const parts = line.split(/(https?:\/\/[^\s<>"'）」]+)/g);
	return parts.map((part, index) =>
		/^https?:\/\//.test(part) ? (
			<a key={index} href={part} target="_blank" rel="noreferrer">
				{part}
			</a>
		) : (
			<Fragment key={index}>{part}</Fragment>
		),
	);
}

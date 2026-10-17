"use client";

import { ChevronDownIcon, EllipsisVerticalIcon, PencilIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { forwardRef, useState, type HTMLAttributes } from "react";
import { Menu, MenuItem, MenuNote, MenuTitle } from "@/components/ActionMenu";
import { AvatarStack, MemberAvatar, UnknownAvatar } from "@/components/Avatar";
import { Spinner } from "@/components/ui/spinner";
import { RUNNABLE, runnerOf } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { CardView, MemberView } from "@/lib/view";

export type CardHandlers = {
	/** Reads the card in the side drawer. */
	onOpen: () => void;
	/** Opens the card in the large dialog, ready to write in. */
	onEdit: () => void;
	/** Asks to delete the card; the board confirms first. */
	onDelete: () => void;
	/** Asks a Grok Bot to carry out the card. Resolves once the board has answered. */
	onRun: (botId: string) => Promise<boolean>;
	onStopRun: () => Promise<boolean>;
	bots: readonly MemberView[];
};

type Props = {
	card: CardView;
	handlers: CardHandlers;
	dragging?: boolean;
	overlay?: boolean;
	highlighted?: boolean;
	/** The dragged card is over a member in the dock and shrinks toward it. */
	toMember?: boolean;
} & HTMLAttributes<HTMLElement>;

/** The compact card on the board. Everything else about a card lives in the drawer. */
const CardPanel = forwardRef<HTMLElement, Props>(function CardPanel(
	{ card, handlers, dragging, overlay, highlighted, toMember, className, style, onKeyDown, ...rest },
	ref,
) {
	const lead = card.assignees[0] ?? null;
	// Low priority fades the card's text only, so the card's own menus stay solid.
	const faded = card.priority === "low" ? "opacity-80" : undefined;

	return (
		<article
			ref={ref}
			data-card-id={card.id}
			data-priority={card.priority}
			className={cn(
				"group/card relative cursor-pointer touch-manipulation rounded-xl border bg-card py-2.5 pr-3 pl-[15px] transition-colors outline-none select-none [--surface:var(--card)] [-webkit-touch-callout:none]",
				"before:absolute before:inset-y-2.5 before:left-[5px] before:w-[3px] before:rounded-full before:bg-(--stripe)",
				!lead && "before:w-0 before:border-l-2 before:border-dashed before:border-line before:bg-transparent",
				"hover:border-line hover:bg-accent focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40",
				card.run?.status === "working" && "border-teal-line",
				dragging && "border-dashed opacity-30",
				overlay && "cursor-grabbing border-primary shadow-[0_18px_40px_#0009] transition-[transform,opacity] duration-150",
				overlay && toMember && "origin-top-left scale-50 opacity-85",
				highlighted && "border-primary ring-[3px] ring-primary/25",
				className,
			)}
			style={{ ...style, "--stripe": lead?.color ?? "transparent" } as React.CSSProperties}
			onClick={(event) => {
				if (!(event.target instanceof Element && event.target.closest("button, a"))) handlers.onOpen();
			}}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (event.key === "Enter" && event.target === event.currentTarget) handlers.onOpen();
			}}
			{...rest}
		>
			<div className="flex items-start gap-1.5">
				<h3 className={cn("min-w-0 flex-1 text-sm leading-[1.45] font-bold break-words", faded)} lang="ja">
					{card.title || "Untitled"}
				</h3>
				{overlay ? null : <CardMenu card={card} handlers={handlers} />}
			</div>
			{card.body ? (
				<p className={cn("mt-1 line-clamp-2 text-[13px] leading-[1.55] whitespace-pre-wrap text-soft-text", faded)} lang="ja">
					{card.body}
				</p>
			) : null}
			<div className="mt-2 flex flex-wrap items-center gap-1 empty:hidden">
				{overlay ? card.run ? <RunPill run={card.run} /> : null : <CardRun card={card} handlers={handlers} />}
				{card.priority === "high" ? <Tag className="bg-danger-soft font-bold text-[#ffd2ca]">High</Tag> : null}
				{card.priority === "low" ? <Tag className={cn("border bg-transparent text-muted-foreground", faded)}>Low</Tag> : null}
				{card.repoLabel ? <Tag className={faded}>{card.repoLabel}</Tag> : null}
				{card.kind.type === "voice" ? <Tag className={faded}>Voice {card.kind.seconds}s</Tag> : null}
				{card.source ? <Tag className={faded}>{card.source}</Tag> : null}
				{card.screened ? <Tag className={cn("bg-[#1f3a2e] text-[#c8f2d0]", faded)}>Screened</Tag> : null}
			</div>
			<footer className={cn("mt-2.5 flex min-h-6 items-center gap-2", faded)}>
				<span className="mr-auto inline-flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground" title={card.createdBy ? `Filed by ${card.createdBy.name}` : "Filed over the API"}>
					{card.createdBy ? <MemberAvatar member={card.createdBy} size={18} /> : <UnknownAvatar size={18} />}
					<time className="whitespace-nowrap text-faint">{card.age}</time>
				</span>
				{card.links.pr ? (
					<a className="rounded-md bg-secondary px-1.5 py-px text-xs font-bold text-link no-underline hover:bg-line" href={card.links.pr} target="_blank" rel="noreferrer" data-no-dnd>
						PR
					</a>
				) : null}
				{card.assignees.length ? (
					<span aria-label={`Assigned to ${card.assignees.map((member) => member.name).join(", ")}`}>
						<AvatarStack members={card.assignees} size={22} max={3} />
					</span>
				) : (
					<span className="truncate text-[11px] text-faint">Unassigned</span>
				)}
			</footer>
		</article>
	);
});

export default CardPanel;

function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
	return <span className={cn("max-w-full truncate rounded-md bg-secondary px-[7px] py-px text-[11px] text-soft-text", className)}>{children}</span>;
}

export function RunPill({ run }: { run: NonNullable<CardView["run"]> }) {
	const text = run.status === "working" ? `${run.bot.name} working` : `Waiting for ${run.bot.name}`;
	return (
		<span
			className={cn(
				"inline-flex flex-none items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1 text-[11px] font-bold whitespace-nowrap",
				run.status === "working" ? "bg-teal-soft text-teal" : "bg-amber-soft text-primary",
			)}
			title={`${text}, ${run.since === "just now" ? "just now" : `${run.since} ago`}`}
		>
			{run.status === "working" ? <span className="size-[7px] animate-pulse-dot rounded-full bg-teal" aria-hidden="true" /> : null}
			<MemberAvatar member={run.bot} size={14} />
			<span data-slot="run-status" lang="ja">
				{run.status === "working" ? "Running" : "Run requested"}
			</span>
		</span>
	);
}

const runButton =
	"inline-flex h-6 items-center gap-1.5 rounded-full border border-teal-line px-2.5 text-xs font-bold text-teal transition-colors hover:border-teal hover:bg-teal-soft data-[state=open]:border-teal data-[state=open]:bg-teal-soft disabled:opacity-60 [&_svg]:size-3";

/**
 * Run on the card. With a Bot among the assignees it runs straight away; with none it asks which Bot to
 * use. While a run is waiting or working, the badge opens a menu to cancel it.
 */
function CardRun({ card, handlers }: { card: CardView; handlers: CardHandlers }) {
	const [busy, setBusy] = useState(false);
	const run = card.run;
	if (!run && !RUNNABLE.includes(card.column)) return null;
	const label = card.column === "inProgress" ? "Re-run" : "Run";
	const runner = runnerOf(
		card.assignees.map((member) => member.id),
		handlers.bots,
	);
	// One request at a time, so a double click does not queue the card twice.
	const act = async (work: () => Promise<boolean>) => {
		if (busy) return;
		setBusy(true);
		await work();
		setBusy(false);
	};

	if (run) {
		return (
			<span data-no-dnd>
				<Menu
					align="start"
					trigger={
						<button
							type="button"
							className="rounded-full hover:shadow-[0_0_0_1px_currentColor] data-[state=open]:shadow-[0_0_0_1px_currentColor]"
							aria-label={run.status === "working" ? `${run.bot.name} is running this card` : `Waiting for ${run.bot.name}`}
						>
							<RunPill run={run} />
						</button>
					}
				>
					<MenuNote>{run.status === "working" ? `${run.bot.name} is on it.` : `${run.bot.name} has not picked it up yet.`}</MenuNote>
					<MenuItem danger onSelect={() => void act(handlers.onStopRun)}>
						<XIcon />
						Cancel run
					</MenuItem>
				</Menu>
			</span>
		);
	}
	if (runner) {
		return (
			<span data-no-dnd>
				<button type="button" className={runButton} title={`${label} with ${runner.name}`} disabled={busy} onClick={() => void act(() => handlers.onRun(runner.id))}>
					{busy ? <Spinner /> : <PlayIcon className="fill-current" />}
					{label}
				</button>
			</span>
		);
	}
	return (
		<span data-no-dnd>
			<Menu
				align="start"
				trigger={
					<button type="button" className={runButton} title={`${label} with a Grok Bot`} disabled={busy}>
						{busy ? <Spinner /> : <PlayIcon className="fill-current" />}
						{label}
						<ChevronDownIcon />
					</button>
				}
			>
				<MenuTitle>{label} with</MenuTitle>
				{handlers.bots.length === 0 ? <MenuNote>No bots yet. Connect one under Bots & MCP.</MenuNote> : null}
				{handlers.bots.map((bot) => (
					<MenuItem key={bot.id} onSelect={() => void act(() => handlers.onRun(bot.id))}>
						<MemberAvatar member={bot} size={18} />
						<span lang="ja">{bot.name}</span>
					</MenuItem>
				))}
			</Menu>
		</span>
	);
}

function CardMenu({ card, handlers }: { card: CardView; handlers: CardHandlers }) {
	return (
		<span className="-mt-[3px] -mr-1.5 flex-none" data-no-dnd>
			<Menu
				trigger={
					<button
						type="button"
						className="grid size-[26px] place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
						aria-label="Card actions"
						title={`Actions for ${card.title}`}
					>
						<EllipsisVerticalIcon className="size-4" />
					</button>
				}
			>
				<MenuItem onSelect={handlers.onEdit}>
					<PencilIcon />
					Edit
				</MenuItem>
				<MenuItem danger onSelect={handlers.onDelete}>
					<Trash2Icon />
					Delete
				</MenuItem>
			</Menu>
		</span>
	);
}

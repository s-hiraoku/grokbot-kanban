"use client";

import { EllipsisVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { forwardRef, type HTMLAttributes } from "react";
import { Menu, MenuItem } from "@/components/ActionMenu";
import { AvatarStack, MemberAvatar, UnknownAvatar } from "@/components/Avatar";
import { CreatedAt } from "@/components/CreatedAt";
import type { Command } from "@/components/Board";
import { RunControl } from "@/components/RunControl";
import { cn } from "@/lib/utils";
import { excerpt, type CardView, type MemberView } from "@/lib/view";

export type CardHandlers = {
	/** Reads the card in the side drawer. */
	onOpen: () => void;
	/** Opens the card in the large dialog, ready to write in. */
	onEdit: () => void;
	/** Asks to delete the card; the board confirms first. */
	onDelete: () => void;
	/** Sends Run, Cursor, and Cancel run for the card. Resolves once the board has answered. */
	send: (command: Command) => Promise<boolean>;
	bots: readonly MemberView[];
	cursorEnabled: boolean;
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
	const preview = excerpt(card.body);

	return (
		<article
			ref={ref}
			data-card-id={card.id}
			data-priority={card.priority}
			className={cn(
				"group/card relative cursor-pointer touch-manipulation rounded-md border border-line/70 bg-card py-2.5 pr-2.5 pl-4 transition-colors outline-none select-none [--surface:var(--card)] [-webkit-touch-callout:none]",
				"before:absolute before:inset-y-2.5 before:left-[6px] before:w-[3px] before:rounded-full before:bg-(--stripe)",
				!lead && "before:w-0 before:border-l-2 before:border-dashed before:border-line before:bg-transparent",
				"hover:border-card-hover-line focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40",
				card.run?.status === "working" && "border-teal-line",
				dragging && "border-dashed opacity-30",
				overlay && "cursor-grabbing border-primary shadow-[0_18px_40px_var(--shadow)] transition-[transform,opacity] duration-150",
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
				<h3 className={cn("min-w-0 flex-1 text-[13.5px] leading-normal font-bold break-words", faded)} lang="ja">
					{card.title || "Untitled"}
				</h3>
				{overlay ? null : <CardMenu card={card} handlers={handlers} />}
			</div>
			{preview ? (
				<p className={cn("mt-1 line-clamp-2 text-xs leading-[1.65] break-words text-soft-text", faded)} lang="ja">
					{preview}
				</p>
			) : null}
			<div className="mt-2.5 flex flex-wrap items-center gap-1.5 empty:hidden">
				<span className={cn("contents", overlay && "pointer-events-none")}>
					<RunControl card={card} bots={handlers.bots} cursorEnabled={handlers.cursorEnabled} size="card" send={handlers.send} />
				</span>
				{card.priority === "high" ? <Tag className="bg-danger-soft font-bold text-danger-text">High</Tag> : null}
				{card.priority === "low" ? <Tag className={cn("border bg-transparent text-muted-foreground", faded)}>Low</Tag> : null}
				{card.repoLabel ? <Tag className={faded}>{card.repoLabel}</Tag> : null}
				{card.kind.type === "voice" ? <Tag className={faded}>Voice {card.kind.seconds}s</Tag> : null}
				{card.source ? <Tag className={faded}>{card.source}</Tag> : null}
				{card.screened ? <Tag className={cn("bg-ok-soft text-ok-text", faded)}>Screened</Tag> : null}
			</div>
			<footer className={cn("mt-3 flex min-h-6 items-center gap-2 border-t border-line/50 pt-2.5", faded)}>
				<span className="mr-auto inline-flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground" title={card.createdBy ? `Filed by ${card.createdBy.name}` : "Filed over the API"}>
					{card.createdBy ? <MemberAvatar member={card.createdBy} size={18} /> : <UnknownAvatar size={18} />}
					<CreatedAt iso={card.createdAt} age={card.age} />
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
					<span className="truncate text-xs text-muted-foreground">Unassigned</span>
				)}
			</footer>
		</article>
	);
});

export default CardPanel;

function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
	return <span className={cn("max-w-full truncate rounded-md bg-secondary px-2 py-0.5 text-xs leading-4 text-soft-text", className)}>{children}</span>;
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

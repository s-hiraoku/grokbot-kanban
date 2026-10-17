"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { AvatarStack, MemberAvatar } from "@/components/Avatar";
import { Menu, MenuItem, MenuNote, MenuTitle } from "@/components/ui/Menu";
import { RUNNABLE, runnerOf } from "@/lib/domain";
import type { CardView, MemberView } from "@/lib/view";

export type CardHandlers = {
	/** Reads the card in the side drawer. */
	onOpen: () => void;
	/** Opens the card in the large dialog, ready to write in. */
	onEdit: () => void;
	onDelete: () => void;
	/** Asks a Grok Bot to carry out the card. */
	onRun: (botId: string) => void;
	onStopRun: () => void;
	bots: readonly MemberView[];
};

type Props = {
	card: CardView;
	handlers: CardHandlers;
	dragging?: boolean;
	overlay?: boolean;
	highlighted?: boolean;
} & HTMLAttributes<HTMLElement>;

/** The compact card on the board. Everything else about a card lives in the drawer. */
const CardPanel = forwardRef<HTMLElement, Props>(function CardPanel(
	{ card, handlers, dragging, overlay, highlighted, className, style, onKeyDown, ...rest },
	ref,
) {
	const lead = card.assignees[0] ?? null;
	const classes = [
		"card",
		`priority-${card.priority}`,
		lead ? "" : "no-owner",
		card.run ? `is-${card.run.status}` : "",
		dragging ? "dragging" : "",
		overlay ? "overlay" : "",
		highlighted ? "highlighted" : "",
		className ?? "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<article
			ref={ref}
			className={classes}
			data-card-id={card.id}
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
			<div className="card-head">
				<h3 className="title" lang="ja">
					{card.title || "Untitled"}
				</h3>
				{overlay ? null : <CardMenu handlers={handlers} />}
			</div>
			{card.body ? (
				<p className="body" lang="ja">
					{card.body}
				</p>
			) : null}
			<div className="tags">
				{overlay ? (card.run ? <RunPill run={card.run} /> : null) : <CardRun card={card} handlers={handlers} />}
				{card.priority === "high" ? <span className="tag high">High</span> : null}
				{card.priority === "low" ? <span className="tag low">Low</span> : null}
				{card.repoLabel ? <span className="tag repo">{card.repoLabel}</span> : null}
				{card.kind.type === "voice" ? <span className="tag">Voice {card.kind.seconds}s</span> : null}
				{card.source ? <span className="tag">{card.source}</span> : null}
				{card.screened ? <span className="tag ok">Screened</span> : null}
			</div>
			<footer className="card-foot">
				<span className="filed" title={card.createdBy ? `Filed by ${card.createdBy.name}` : "Filed over the API"}>
					{card.createdBy ? <MemberAvatar member={card.createdBy} size={18} /> : <span className="avatar unknown" style={{ width: 18, height: 18 }}>?</span>}
					<time>{card.age}</time>
				</span>
				{card.links.pr ? (
					<a className="pr-link" href={card.links.pr} target="_blank" rel="noreferrer" data-no-dnd>
						PR
					</a>
				) : null}
				{card.assignees.length ? (
					<span className="owners" aria-label={`Assigned to ${card.assignees.map((member) => member.name).join(", ")}`}>
						<AvatarStack members={card.assignees} size={22} max={3} />
					</span>
				) : (
					<span className="owners nobody">Unassigned</span>
				)}
			</footer>
		</article>
	);
});

export default CardPanel;

export function RunPill({ run }: { run: NonNullable<CardView["run"]> }) {
	const text = run.status === "working" ? `${run.bot.name} working` : `Waiting for ${run.bot.name}`;
	return (
		<span className={`pill ${run.status}`} title={`${text}, ${run.since === "just now" ? "just now" : `${run.since} ago`}`}>
			{run.status === "working" ? <span className="pulse" aria-hidden="true" /> : null}
			<MemberAvatar member={run.bot} size={14} />
			<span className="pill-text" lang="ja">
				{run.status === "working" ? "Running" : "Run requested"}
			</span>
		</span>
	);
}

/**
 * Run on the card. With a Bot among the assignees it runs straight away; with none it asks which Bot to
 * use. While a run is waiting or working, the badge opens a menu to cancel it.
 */
function CardRun({ card, handlers }: { card: CardView; handlers: CardHandlers }) {
	const run = card.run;
	if (!run && !RUNNABLE.includes(card.column)) return null;
	const label = card.column === "inProgress" ? "Re-run" : "Run";
	const runner = runnerOf(
		card.assignees.map((member) => member.id),
		handlers.bots,
	);
	if (run) {
		return (
			<div className="card-run" data-no-dnd>
				<Menu
					align="start"
					trigger={
						<button type="button" className="run-trigger" aria-label={run.status === "working" ? `${run.bot.name} is running this card` : `Waiting for ${run.bot.name}`}>
							<RunPill run={run} />
						</button>
					}
				>
					<MenuNote>{run.status === "working" ? `${run.bot.name} is on it.` : `${run.bot.name} has not picked it up yet.`}</MenuNote>
					<MenuItem danger onSelect={handlers.onStopRun}>
						Cancel run
					</MenuItem>
				</Menu>
			</div>
		);
	}
	if (runner) {
		return (
			<div className="card-run" data-no-dnd>
				<button type="button" className="card-run-button" title={`${label} with ${runner.name}`} onClick={() => handlers.onRun(runner.id)}>
					<PlayIcon />
					{label}
				</button>
			</div>
		);
	}
	return (
		<div className="card-run" data-no-dnd>
			<Menu
				align="start"
				className="run-menu"
				trigger={
					<button type="button" className="card-run-button" title={`${label} with a Grok Bot`}>
						<PlayIcon />
						{label}
						<svg className="caret" viewBox="0 0 10 6" aria-hidden="true">
							<path d="M1 1l4 4 4-4" />
						</svg>
					</button>
				}
			>
				<MenuTitle>{label} with</MenuTitle>
				{handlers.bots.length === 0 ? <MenuNote>No bots yet. Connect one under Bots & MCP.</MenuNote> : null}
				{handlers.bots.map((bot) => (
					<MenuItem key={bot.id} onSelect={() => handlers.onRun(bot.id)}>
						<MemberAvatar member={bot} size={18} />
						<span lang="ja">{bot.name}</span>
					</MenuItem>
				))}
			</Menu>
		</div>
	);
}

function PlayIcon() {
	return (
		<svg viewBox="0 0 10 12" aria-hidden="true">
			<path d="M1 1l8 5-8 5z" />
		</svg>
	);
}

function CardMenu({ handlers }: { handlers: CardHandlers }) {
	return (
		<div className="card-menu" data-no-dnd>
			<Menu
				trigger={
					<button type="button" className="menu-button" aria-label="Card actions">
						<svg viewBox="0 0 4 16" aria-hidden="true">
							<circle cx="2" cy="2" r="1.6" />
							<circle cx="2" cy="8" r="1.6" />
							<circle cx="2" cy="14" r="1.6" />
						</svg>
					</button>
				}
			>
				<MenuItem onSelect={handlers.onEdit}>Edit</MenuItem>
				<MenuItem danger onSelect={handlers.onDelete}>
					Delete
				</MenuItem>
			</Menu>
		</div>
	);
}

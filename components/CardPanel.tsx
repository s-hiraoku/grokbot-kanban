"use client";

import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { AvatarStack, MemberAvatar } from "@/components/Avatar";
import { RUNNABLE } from "@/lib/domain";
import type { CardView, MemberView } from "@/lib/view";

export type CardHandlers = {
	onOpen: () => void;
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
				{overlay ? null : <CardMenu card={card} handlers={handlers} />}
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

/** A small menu on the card that closes on an outside press or Escape. */
function usePopover() {
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", escape);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", escape);
		};
	}, [open]);
	return { open, setOpen, box };
}

/** Run on the card: pick a Grok Bot to carry it out, or see and cancel the run in progress. */
function CardRun({ card, handlers }: { card: CardView; handlers: CardHandlers }) {
	const { open, setOpen, box } = usePopover();
	const run = card.run;
	const assigned = new Set(card.assignees.map((member) => member.id));
	const bots = [...handlers.bots.filter((bot) => assigned.has(bot.id)), ...handlers.bots.filter((bot) => !assigned.has(bot.id))];
	if (!run && !RUNNABLE.includes(card.column)) return null;
	const label = card.column === "inProgress" ? "Re-run" : "Run";
	return (
		<div className="card-run" ref={box} data-no-dnd>
			{run ? (
				<button type="button" className="run-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
					<RunPill run={run} />
				</button>
			) : (
				<button
					type="button"
					className="card-run-button"
					aria-label={`${label} with a Grok Bot`}
					aria-haspopup="menu"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
				>
					<svg viewBox="0 0 10 12" aria-hidden="true">
						<path d="M1 1l8 5-8 5z" />
					</svg>
					{label}
				</button>
			)}
			{open ? (
				<div className="menu run-menu" role="menu">
					{run ? (
						<>
							<p className="menu-note">{run.status === "working" ? `${run.bot.name} is on it.` : `${run.bot.name} has not picked it up yet.`}</p>
							<button
								type="button"
								role="menuitem"
								className="danger-item"
								onClick={() => {
									setOpen(false);
									handlers.onStopRun();
								}}
							>
								Cancel run
							</button>
						</>
					) : (
						<>
							<p className="menu-title">{label} with</p>
							{bots.length === 0 ? <p className="menu-note">No bots yet. Connect one under Bots & MCP.</p> : null}
							{bots.map((bot) => (
								<button
									key={bot.id}
									type="button"
									role="menuitem"
									onClick={() => {
										setOpen(false);
										handlers.onRun(bot.id);
									}}
								>
									<MemberAvatar member={bot} size={18} />
									<span>{bot.name}</span>
									{assigned.has(bot.id) ? <span className="menu-hint">assigned</span> : null}
								</button>
							))}
						</>
					)}
				</div>
			) : null}
		</div>
	);
}

function CardMenu({ card, handlers }: { card: CardView; handlers: CardHandlers }) {
	const { open, setOpen, box } = usePopover();
	return (
		<div className="card-menu" ref={box} data-no-dnd>
			<button
				type="button"
				className="menu-button"
				aria-label="Card actions"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<svg viewBox="0 0 4 16" aria-hidden="true">
					<circle cx="2" cy="2" r="1.6" />
					<circle cx="2" cy="8" r="1.6" />
					<circle cx="2" cy="14" r="1.6" />
				</svg>
			</button>
			{open ? (
				<div className="menu" role="menu">
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							handlers.onOpen();
						}}
					>
						Edit
					</button>
					<button
						type="button"
						role="menuitem"
						className="danger-item"
						onClick={() => {
							setOpen(false);
							handlers.onDelete();
						}}
					>
						Delete
					</button>
				</div>
			) : null}
		</div>
	);
}

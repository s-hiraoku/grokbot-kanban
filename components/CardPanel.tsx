"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { AvatarStack, MemberAvatar } from "@/components/Avatar";
import type { CardView } from "@/lib/view";

export type CardHandlers = {
	onRun: () => void;
	onStop: () => void;
	onOpen: () => void;
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
		card.pill ? `is-${card.pill.label}` : "",
		dragging ? "dragging" : "",
		overlay ? "overlay" : "",
		highlighted ? "highlighted" : "",
		className ?? "",
	]
		.filter(Boolean)
		.join(" ");
	const showAction = card.action.command === "stop" || (card.action.enabled && card.repo !== null && card.column !== "done" && card.column !== "wontDo");

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
				{card.pill ? (
					<span className={`pill ${card.pill.label}`}>
						{card.pill.label === "running" ? <span className="pulse" aria-hidden="true" /> : null}
						{card.pill.label === "running" ? "Running" : "Waiting for a slot"}
					</span>
				) : null}
			</div>
			{card.body ? (
				<p className="body" lang="ja">
					{card.body}
				</p>
			) : null}
			<div className="tags">
				{card.priority === "high" ? <span className="tag high">High</span> : null}
				{card.priority === "low" ? <span className="tag low">Low</span> : null}
				{card.repoLabel ? <span className="tag repo">{card.repoLabel}</span> : null}
				{card.kind.type === "voice" ? <span className="tag">Voice {card.kind.seconds}s</span> : null}
				{card.source ? <span className="tag">{card.source}</span> : null}
				{card.screened ? <span className="tag ok">Screened</span> : null}
			</div>
			{card.failure ? <p className="failure">{card.failure}</p> : null}
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
				{showAction ? (
					<button
						type="button"
						className={`card-action ${card.action.command}`}
						disabled={!card.action.enabled}
						data-no-dnd
						onClick={() => (card.action.command === "stop" ? handlers.onStop() : handlers.onRun())}
					>
						{card.action.label}
					</button>
				) : null}
			</footer>
		</article>
	);
});

export default CardPanel;

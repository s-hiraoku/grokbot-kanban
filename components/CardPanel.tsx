"use client";

import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { AvatarStack, MemberAvatar } from "@/components/Avatar";
import { COLUMNS, type ParkColumn } from "@/lib/domain";
import type { CardView, MemberView } from "@/lib/view";

export type CardHandlers = {
	onRun: () => void;
	onStop: () => void;
	onMove: (to: ParkColumn) => void;
	onEdit: (patch: Record<string, unknown>) => void;
	onOpen: () => void;
};

type Props = {
	card: CardView;
	members: readonly MemberView[];
	handlers: CardHandlers;
	dragging?: boolean;
	overlay?: boolean;
	highlighted?: boolean;
} & HTMLAttributes<HTMLElement>;

const CardPanel = forwardRef<HTMLElement, Props>(function CardPanel(
	{ card, members, handlers, dragging, overlay, highlighted, className, ...rest },
	ref,
) {
	const [notes, setNotes] = useState(card.notes);
	useEffect(() => setNotes(card.notes), [card.notes]);
	const [reviewer, setReviewer] = useState(card.reviewer === "grok" ? "grok" : "owner");
	const classes = ["card", `priority-${card.priority}`, dragging ? "dragging" : "", overlay ? "overlay" : "", highlighted ? "highlighted" : "", className ?? ""]
		.filter(Boolean)
		.join(" ");

	return (
		<article ref={ref} className={classes} data-card-id={card.id} {...rest}>
			<div className="card-top">
				{card.createdBy ? (
					<MemberAvatar member={card.createdBy} />
				) : (
					<span className="avatar unknown" title="Filed over the API without a bot name">
						?
					</span>
				)}
				<span className="meta">
					{card.createdBy ? <span className="by">{card.createdBy.name}</span> : null}
					<span>{card.age}</span>
					<span className="sep">·</span>
					{card.kindLabel}
					<span className="sep">·</span>
					<span className="hex">{card.shortId}</span>
				</span>
				{card.pill ? (
					<span className={`pill ${card.pill.tone}`}>
						{card.pill.label === "running" ? <span className="spinner" /> : null}
						{card.pill.label}
					</span>
				) : null}
			</div>
			{card.title ? (
				<h3
					lang="ja"
					className="title"
					tabIndex={-1}
					onClick={handlers.onOpen}
					title="Open card"
				>
					{card.title}
				</h3>
			) : null}
			{card.body ? (
				<p className="body" lang="ja">
					{card.body}
				</p>
			) : null}
			<div className="tags">
				{card.priority !== "normal" ? <span className={`tag ${card.priority}`}>{card.priority}</span> : null}
				{card.repoLabel ? <span className="tag repo">{card.repoLabel}</span> : null}
				{card.source ? <span className="tag">{card.source}</span> : null}
				{card.screening ? <span className="tag screened-tag">{card.screening}</span> : null}
			</div>
			<p className="links">
				{card.links.character ? (
					<a href={card.links.character} target="_blank" rel="noreferrer" data-no-dnd>
						Character ↗
					</a>
				) : null}
				{card.links.agent ? (
					<a href={card.links.agent} target="_blank" rel="noreferrer" data-no-dnd>
						Agent ↗
					</a>
				) : null}
				{card.links.pr ? (
					<a href={card.links.pr} target="_blank" rel="noreferrer" data-no-dnd>
						PR ↗
					</a>
				) : null}
			</p>
			<AssigneeRow card={card} members={members} onChange={(assignees) => handlers.onEdit({ assignees })} />
			<div className="actions">
				<select
					aria-label="Status"
					value={card.column}
					disabled={card.moveTargets.length === 0}
					data-no-dnd
					onChange={(event) => {
						const next = event.target.value;
						if ((card.moveTargets as readonly string[]).includes(next)) handlers.onMove(next as ParkColumn);
					}}
				>
					{COLUMNS.map((column) => (
						<option key={column.id} value={column.id} disabled={!(card.moveTargets as readonly string[]).includes(column.id) && column.id !== card.column}>
							{column.label}
						</option>
					))}
				</select>
				<button
					type="button"
					className={card.action.command === "stop" ? "stop" : "run"}
					disabled={!card.action.enabled}
					data-no-dnd
					onClick={() => (card.action.command === "stop" ? handlers.onStop() : handlers.onRun())}
				>
					{card.action.label}
				</button>
				<button type="button" className="icon" aria-label="Edit card" title="Edit card" data-no-dnd onClick={handlers.onOpen}>
					✎
				</button>
			</div>
			{card.hint ? <p className="hint">{card.hint}</p> : null}
			{card.failure ? <p className="failure">{card.failure}</p> : null}
			<details className="notes" data-no-dnd>
				<summary>Notes & moderation{card.notes ? ` · ${card.notes.split("\n").length}` : ""}</summary>
				<textarea
					lang="ja"
					value={notes}
					onChange={(event) => setNotes(event.target.value)}
					onBlur={() => {
						if (notes !== card.notes) handlers.onEdit({ notes });
					}}
				/>
				<label className="screened">
					<input
						type="checkbox"
						checked={card.screened}
						onChange={(event) => handlers.onEdit({ screening: event.target.checked ? { by: reviewer } : null })}
					/>
					screened
				</label>
				{card.screened ? (
					<select
						aria-label="Reviewer"
						value={reviewer}
						onChange={(event) => {
							const by = event.target.value;
							setReviewer(by);
							handlers.onEdit({ screening: { by } });
						}}
					>
						<option value="owner">owner</option>
						<option value="grok">grok</option>
					</select>
				) : null}
			</details>
		</article>
	);
});

export default CardPanel;

function AssigneeRow({
	card,
	members,
	onChange,
}: {
	card: CardView;
	members: readonly MemberView[];
	onChange: (assignees: string[]) => void;
}) {
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
	const ids = card.assignees.map((member) => member.id);
	const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

	return (
		<div className="assignees" ref={box}>
			<button
				type="button"
				className="assign-button"
				data-no-dnd
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				{card.assignees.length ? (
					<>
						<AvatarStack members={card.assignees} />
						<span className="assignee-names">{card.assignees.map((member) => member.name).join(", ")}</span>
					</>
				) : (
					<span className="unassigned">＋ Assign</span>
				)}
			</button>
			{open ? (
				<div className="popover" role="listbox" aria-label="Assignees" data-no-dnd>
					{members.map((member) => (
						<label key={member.id} className="pick">
							<input type="checkbox" checked={ids.includes(member.id)} onChange={() => toggle(member.id)} />
							<MemberAvatar member={member} size={20} />
							<span>{member.name}</span>
						</label>
					))}
					{members.length <= 1 ? <p className="muted small">Bots appear here once they use the board, or add one under Bots.</p> : null}
					{ids.length ? (
						<button type="button" className="ghost small" onClick={() => onChange([])}>
							Clear
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

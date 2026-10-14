"use client";

import { useEffect, useState } from "react";
import { COLUMNS, type ParkColumn } from "@/lib/domain";
import type { CardView } from "@/lib/view";

export default function CardPanel({
	card,
	onRun,
	onStop,
	onMove,
	onEdit,
}: {
	card: CardView;
	onRun: () => void;
	onStop: () => void;
	onMove: (to: ParkColumn) => void;
	onEdit: (patch: Record<string, unknown>) => void;
}) {
	const [notes, setNotes] = useState(card.notes);
	useEffect(() => setNotes(card.notes), [card.notes]);
	const [reviewer, setReviewer] = useState(card.reviewer === "grok" ? "grok" : "owner");
	const letter = Array.from(card.title)[0] ?? "?";
	const hue = Array.from(card.shortId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
	const draggable = card.moveTargets.length > 0;

	return (
		<article
			className="card"
			draggable={draggable}
			onDragStart={(event) => {
				event.dataTransfer.setData("text/plain", card.id);
				event.dataTransfer.effectAllowed = "move";
			}}
		>
			<div className="card-top">
				<span className="avatar" style={{ background: `hsl(${hue} 42% 42%)` }}>
					{letter}
				</span>
				<span className="meta">
					{card.age}
					<span className="sep">·</span>
					{card.kindLabel}
					<span className="sep">·</span>
					<span className="hex">{card.shortId}</span>
				</span>
				{card.pill ? <span className={`pill ${card.pill.tone}`}>{card.pill.label === "running" ? <span className="spinner" /> : null}{card.pill.label}</span> : <span />}
			</div>
			{card.title ? <h3 lang="ja">{card.title}</h3> : null}
			{card.body ? <p className="body" lang="ja">{card.body}</p> : null}
			{card.repoLabel ? <p className="repo">{card.repoLabel}</p> : null}
			{card.priority !== "normal" ? <p className="priority">{card.priority}</p> : null}
			{card.screening ? <p className="badge">{card.screening}</p> : null}
			<p className="links">
				{card.links.character ? (
					<a href={card.links.character} target="_blank" rel="noreferrer">
						Character ↗
					</a>
				) : (
					<span className="dead">Character ↗</span>
				)}
				{card.links.agent ? (
					<a href={card.links.agent} target="_blank" rel="noreferrer">
						Agent ↗
					</a>
				) : (
					<span className="dead">Agent ↗</span>
				)}
				{card.links.pr ? (
					<a href={card.links.pr} target="_blank" rel="noreferrer">
						PR ↗
					</a>
				) : null}
			</p>
			<div className="actions">
				<select
					aria-label="Status"
					value={card.column}
					disabled={card.moveTargets.length === 0}
					onChange={(event) => {
						const next = event.target.value;
						if ((card.moveTargets as readonly string[]).includes(next)) onMove(next as ParkColumn);
					}}
				>
					{COLUMNS.map((column) => (
						<option key={column.id} value={column.id} disabled={!(card.moveTargets as readonly string[]).includes(column.id)}>
							{column.label}
						</option>
					))}
				</select>
				<button
					type="button"
					className={card.action.command === "stop" ? "stop" : "run"}
					disabled={!card.action.enabled}
					onClick={() => (card.action.command === "stop" ? onStop() : onRun())}
				>
					{card.action.label}
				</button>
			</div>
			{card.hint ? <p className="hint">{card.hint}</p> : null}
			{card.failure ? <p className="failure">{card.failure}</p> : null}
			<details className="notes">
				<summary>Notes & moderation</summary>
				<textarea
					lang="ja"
					value={notes}
					onChange={(event) => setNotes(event.target.value)}
					onBlur={() => {
						if (notes !== card.notes) onEdit({ notes });
					}}
				/>
				<label className="screened">
					<input
						type="checkbox"
						checked={card.screened}
						onChange={(event) => onEdit({ screening: event.target.checked ? { by: reviewer } : null })}
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
							onEdit({ screening: { by } });
						}}
					>
						<option value="owner">owner</option>
						<option value="grok">grok</option>
					</select>
				) : null}
			</details>
		</article>
	);
}

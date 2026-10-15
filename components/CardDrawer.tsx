"use client";

import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/Avatar";
import type { Command } from "@/components/Board";
import { COLUMNS, type ParkColumn } from "@/lib/domain";
import type { CardView, MemberView } from "@/lib/view";

const PRIORITIES = [
	{ id: "low", label: "Low" },
	{ id: "normal", label: "Normal" },
	{ id: "high", label: "High" },
] as const;

/** Opens beside the board to read, edit, move, and run one card, or to write a new one. */
export default function CardDrawer({
	card,
	members,
	send,
	onSubmit,
	onClose,
}: {
	card: CardView | null;
	members: readonly MemberView[];
	send: (command: Command) => Promise<boolean>;
	onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
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
	const [busy, setBusy] = useState(false);
	const first = useRef<HTMLInputElement>(null);
	const panel = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (!card) first.current?.focus();
		else panel.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// Focus once on open, not on every board refresh.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onClose]);

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
	const dirty = card ? Object.keys(changes()).length > 0 : title.trim().length > 0;
	const columnLabel = (id: string) => COLUMNS.find((column) => column.id === id)?.label ?? id;
	const toggle = (id: string) => setAssignees((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

	return (
		<div className="drawer-scrim" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<form
				ref={panel}
				tabIndex={-1}
				className="drawer"
				role="dialog"
				aria-modal="true"
				aria-label={card ? `Card ${card.title}` : "New card"}
				onSubmit={async (event) => {
					event.preventDefault();
					if (!dirty) {
						onClose();
						return;
					}
					setBusy(true);
					await onSubmit(changes());
					setBusy(false);
				}}
			>
				<header className="drawer-head">
					{card ? (
						<span className={`stage col-${card.column}`}>
							<span className="lamp" aria-hidden="true" />
							{columnLabel(card.column)}
						</span>
					) : (
						<span className="stage col-inbox">
							<span className="lamp" aria-hidden="true" />
							New card for Inbox
						</span>
					)}
					{card ? <span className="card-id">#{card.shortId}</span> : null}
					<button type="button" className="icon" aria-label="Close" onClick={onClose}>
						×
					</button>
				</header>

				<div className="drawer-body">
					<label className="title-field">
						<span className="visually-hidden">Title</span>
						<input ref={first} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} lang="ja" placeholder="What needs doing?" />
					</label>
					{card ? (
						<p className="filed-line">
							{card.createdBy ? <MemberAvatar member={card.createdBy} size={20} /> : null}
							<span>
								Filed by {card.createdBy?.name ?? "the API"}, {card.age === "just now" ? "just now" : `${card.age} ago`}
							</span>
						</p>
					) : null}

					{card ? (
						<section className="run-box" aria-label="Status">
							{card.hint ? <p className="hint">{card.hint}</p> : null}
							{card.failure ? <p className="failure">{card.failure}</p> : null}
							<div className="run-row">
								{card.action.command === "stop" || card.repo ? (
									<button
										type="button"
										className={`run-button ${card.action.command}`}
										disabled={!card.action.enabled}
										onClick={() => void send({ type: card.action.command, cardId: card.id })}
									>
										{card.action.command === "stop" ? "Stop agent" : card.action.label === "Re-run" ? "Re-run agent" : "Run agent"}
									</button>
								) : (
									<p className="muted small">Add a repo below to run a Cursor agent.</p>
								)}
								{card.links.agent ? (
									<a href={card.links.agent} target="_blank" rel="noreferrer">
										Open agent
									</a>
								) : null}
								{card.links.pr ? (
									<a href={card.links.pr} target="_blank" rel="noreferrer">
										Open PR
									</a>
								) : null}
							</div>
							{card.moveTargets.filter((target) => target !== card.column).length ? (
								<div className="move-row">
									<span className="muted small">Move to</span>
									{card.moveTargets
										.filter((target) => target !== card.column)
										.map((target: ParkColumn) => (
											<button key={target} type="button" className={`move col-${target}`} onClick={() => void send({ type: "move", cardId: card.id, to: target })}>
												<span className="lamp" aria-hidden="true" />
												{columnLabel(target)}
											</button>
										))}
								</div>
							) : null}
						</section>
					) : null}

					<fieldset className="field assign-field">
						<legend>Assignees</legend>
						<div className="chips">
							{members.map((member) => (
								<label key={member.id} className={`pick${assignees.includes(member.id) ? " on" : ""}`} style={{ "--member": member.color } as React.CSSProperties}>
									<input type="checkbox" checked={assignees.includes(member.id)} onChange={() => toggle(member.id)} />
									<MemberAvatar member={member} size={22} />
									<span lang="ja">{member.name}</span>
								</label>
							))}
						</div>
						{members.length <= 1 ? <p className="muted small">Bots appear here once they use the board, or add one under Bots & MCP.</p> : null}
					</fieldset>

					<label className="field">
						<span>Details</span>
						<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} lang="ja" placeholder="What the bot reported, steps, context" />
					</label>

					<fieldset className="field">
						<legend>Priority</legend>
						<div className="segmented" role="radiogroup" aria-label="Priority">
							{PRIORITIES.map((item) => (
								<button key={item.id} type="button" role="radio" aria-checked={priority === item.id} className={priority === item.id ? `on p-${item.id}` : ""} onClick={() => setPriority(item.id)}>
									{item.label}
								</button>
							))}
						</div>
					</fieldset>

					<div className="field-grid">
						<label className="field wide">
							<span>Repo</span>
							<input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/org/repo" inputMode="url" />
						</label>
						<label className="field">
							<span>Branch</span>
							<input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="main" />
						</label>
						<label className="field">
							<span>Source</span>
							<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="x, slack" />
						</label>
						<label className="field wide">
							<span>Original post</span>
							<input value={originalLink} onChange={(event) => setOriginalLink(event.target.value)} placeholder="https://" inputMode="url" />
						</label>
						<label className="field">
							<span>Kind</span>
							<select value={kind} onChange={(event) => setKind(event.target.value)}>
								<option value="text">Text</option>
								<option value="voice">Voice</option>
							</select>
						</label>
						{kind === "voice" ? (
							<label className="field">
								<span>Seconds</span>
								<input value={seconds} onChange={(event) => setSeconds(event.target.value)} inputMode="numeric" />
							</label>
						) : null}
					</div>
					{originalLink && /^https:\/\//.test(originalLink) ? (
						<a className="small-link" href={originalLink} target="_blank" rel="noreferrer">
							Open the original post
						</a>
					) : null}

					<label className="field">
						<span>Notes</span>
						<textarea className="notes-area" value={notes} onChange={(event) => setNotes(event.target.value)} rows={6} lang="ja" placeholder="Bots sign their notes here" />
					</label>
					<div className="screen-row">
						<label className="check">
							<input type="checkbox" checked={screened} onChange={(event) => setScreened(event.target.checked)} />
							Screened for moderation
						</label>
						{screened ? (
							<select aria-label="Screened by" value={reviewer} onChange={(event) => setReviewer(event.target.value)}>
								<option value="owner">by you</option>
								<option value="grok">by Grok</option>
							</select>
						) : null}
					</div>
				</div>

				<footer className="drawer-foot">
					<button type="submit" className="primary" disabled={busy || !title.trim() || (card !== null && !dirty)}>
						{card ? "Save changes" : "Add to Inbox"}
					</button>
					<button type="button" className="ghost" onClick={onClose}>
						{card && !dirty ? "Close" : "Cancel"}
					</button>
					{card && (card.column === "inProgress" || card.column === "inReview") ? <span className="muted small">Edits do not change a run already started.</span> : null}
				</footer>
			</form>
		</div>
	);
}

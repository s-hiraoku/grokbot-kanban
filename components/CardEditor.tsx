"use client";

import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/Avatar";
import type { CardView, MemberView } from "@/lib/view";

export default function CardEditor({
	card,
	members,
	onSubmit,
	onClose,
}: {
	card: CardView | null;
	members: readonly MemberView[];
	onSubmit: (payload: Record<string, unknown>) => void | Promise<void>;
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
	const [busy, setBusy] = useState(false);
	const first = useRef<HTMLInputElement>(null);

	useEffect(() => {
		first.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
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
	});

	const changes = () => {
		const next = content();
		if (!card) return { ...next, screening: null };
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
		return patch;
	};

	return (
		<div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<form
				className="modal editor"
				role="dialog"
				aria-modal="true"
				aria-label={card ? "Edit card" : "New card"}
				onSubmit={async (event) => {
					event.preventDefault();
					const payload = changes();
					if (card && Object.keys(payload).length === 0) {
						onClose();
						return;
					}
					setBusy(true);
					await onSubmit(payload);
					setBusy(false);
				}}
			>
				<header className="modal-head">
					<h2>{card ? `Card ${card.shortId}` : "New card"}</h2>
					{card?.createdBy ? (
						<span className="muted small by-line">
							<MemberAvatar member={card.createdBy} size={18} /> filed by {card.createdBy.name} · {card.age}
						</span>
					) : null}
					<button type="button" className="icon" aria-label="Close" onClick={onClose}>
						×
					</button>
				</header>
				<label className="wide">
					Title
					<input ref={first} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} lang="ja" />
				</label>
				<label className="wide">
					Body
					<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} lang="ja" />
				</label>
				<label>
					Repo
					<input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/org/repo" inputMode="url" />
				</label>
				<label>
					Branch
					<input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="main" />
				</label>
				<label>
					Source
					<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="x, slack, …" />
				</label>
				<label>
					Original link
					<input value={originalLink} onChange={(event) => setOriginalLink(event.target.value)} placeholder="https://" inputMode="url" />
				</label>
				<label>
					Priority
					<select value={priority} onChange={(event) => setPriority(event.target.value)}>
						<option value="low">low</option>
						<option value="normal">normal</option>
						<option value="high">high</option>
					</select>
				</label>
				<label>
					Kind
					<select value={kind} onChange={(event) => setKind(event.target.value)}>
						<option value="text">text</option>
						<option value="voice">voice</option>
					</select>
				</label>
				{kind === "voice" ? (
					<label>
						Seconds
						<input value={seconds} onChange={(event) => setSeconds(event.target.value)} inputMode="numeric" />
					</label>
				) : null}
				<fieldset className="wide assign-field">
					<legend>Assignees</legend>
					{members.map((member) => (
						<label key={member.id} className={`pick chip${assignees.includes(member.id) ? " on" : ""}`}>
							<input
								type="checkbox"
								checked={assignees.includes(member.id)}
								onChange={() =>
									setAssignees((current) => (current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id]))
								}
							/>
							<MemberAvatar member={member} size={20} />
							{member.name}
						</label>
					))}
				</fieldset>
				<label className="wide">
					Notes
					<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} lang="ja" />
				</label>
				<div className="modal-actions wide">
					<button type="submit" className="primary" disabled={busy || !title.trim()}>
						{card ? "Save" : "Add to Inbox"}
					</button>
					<button type="button" className="ghost" onClick={onClose}>
						Cancel
					</button>
					{card && (card.column === "inProgress" || card.column === "inReview") ? (
						<span className="muted small">Edits after a run starts do not change that run.</span>
					) : null}
				</div>
			</form>
		</div>
	);
}

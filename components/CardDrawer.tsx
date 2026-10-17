"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import AssigneePicker from "@/components/AssigneePicker";
import { Menu, MenuItem, MenuNote, MenuTitle, escapeClaimed } from "@/components/ui/Menu";
import { MemberAvatar } from "@/components/Avatar";
import type { Command } from "@/components/Board";
import { COLUMNS, RUNNABLE, runnerOf, type Column } from "@/lib/domain";
import type { ToastMessage } from "@/lib/notify";
import type { CardView, MemberView } from "@/lib/view";

const PRIORITIES = [
	{ id: "low", label: "Low" },
	{ id: "normal", label: "Normal" },
	{ id: "high", label: "High" },
] as const;

/**
 * Opens beside the board to read, edit, and move one card, or to write a new one. The expand button
 * widens it into a large centered view with the details in a side column.
 */
export default function CardDrawer({
	card,
	dialog = false,
	closing = false,
	members,
	send,
	notify,
	onSubmit,
	onClose,
}: {
	card: CardView | null;
	/** Opens as the large centered dialog instead of the side drawer, with the details ready to edit. */
	dialog?: boolean;
	/** Plays the exit animation; the board removes the drawer when it ends. */
	closing?: boolean;
	members: readonly MemberView[];
	send: (command: Command) => Promise<boolean>;
	notify: (message: ToastMessage) => void;
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
	// Existing text opens as reading copy; a new card, or a card with nothing written yet, opens for typing.
	const [editingBody, setEditingBody] = useState(dialog || !card?.body);
	const [editingNotes, setEditingNotes] = useState(false);
	const [wide, setWide] = useState(dialog);
	const [busy, setBusy] = useState(false);
	const first = useRef<HTMLTextAreaElement>(null);
	const panel = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (!card) first.current?.focus();
		else panel.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			// An open menu or popover inside the panel takes Escape first.
			if (event.key === "Escape" && !event.isComposing && !escapeClaimed(event)) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// Focus once on open, not on every board refresh.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onClose]);

	// The large view lasts until the drawer closes; every card opens in the drawer again.
	const toggleWide = () => setWide((current) => !current);

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

	const remove = async () => {
		if (!card || !window.confirm(`Delete “${card.title}”? This cannot be undone.`)) return;
		setBusy(true);
		const ok = await send({ type: "deleteCard", cardId: card.id });
		setBusy(false);
		if (ok) onClose();
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

	return (
		<div className={`drawer-scrim${wide ? " wide" : ""}${closing ? " closing" : ""}`} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<form
				ref={panel}
				tabIndex={-1}
				className={`drawer${wide ? " wide" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-label={card ? `Card ${card.title}` : "New card"}
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
					setBusy(true);
					await onSubmit(changes());
					setBusy(false);
				}}
			>
				<header className="drawer-head">
					{card ? (
						<StatusMenu column={card.column} onMove={(to) => void send({ type: "move", cardId: card.id, to })} />
					) : (
						<span className="status-button static col-inbox">
							<span className="lamp" aria-hidden="true" />
							New card for Inbox
						</span>
					)}
					{card ? <RunMenu card={card} members={members} send={send} /> : null}
					{card ? <span className="card-id">#{card.shortId}</span> : null}
					<span className="drawer-tools">
						<button type="button" className="icon" aria-label={wide ? "Show as side panel" : "Open in a large view"} aria-pressed={wide} title={wide ? "Side panel" : "Large view"} onClick={toggleWide}>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								{wide ? <path d="M6.5 2v4.5H2M9.5 14V9.5H14M6.5 6.5 2 2m7.5 7.5L14 14" /> : <path d="M2 6.5V2h4.5M14 9.5V14H9.5M2 2l4.5 4.5M14 14 9.5 9.5" />}
							</svg>
						</button>
						{card ? (
							<Menu
								trigger={
									<button type="button" className="icon" aria-label="More actions" title="More actions">
										<DotsIcon />
									</button>
								}
							>
								<MenuItem onSelect={() => void copyLink()}>Copy link</MenuItem>
								<MenuItem danger onSelect={() => void remove()}>
									Delete card
								</MenuItem>
							</Menu>
						) : null}
						<button type="button" className="icon" aria-label="Close" onClick={onClose}>
							×
						</button>
					</span>
				</header>

				<div className="drawer-body">
					<div className="drawer-main">
						<label className="title-field">
							<span className="visually-hidden">Title</span>
							<GrowingText
								inputRef={first}
								value={title}
								onChange={setTitle}
								required
								maxLength={200}
								placeholder="What needs doing?"
								onEnter={() => panel.current?.requestSubmit()}
							/>
						</label>
						{card ? (
							<p className="filed-line">
								{card.createdBy ? <MemberAvatar member={card.createdBy} size={20} /> : null}
								<span>
									Filed by {card.createdBy?.name ?? "the API"}, {card.age === "just now" ? "just now" : `${card.age} ago`}
								</span>
							</p>
						) : null}
						{card?.run ? (
							<p className={`run-banner ${card.run.status}`}>
								<MemberAvatar member={card.run.bot} size={22} />
								<span lang="ja">
									{card.run.status === "working"
										? `${card.run.bot.name} is working on this card (started ${card.run.since === "just now" ? "just now" : `${card.run.since} ago`}). Its report lands in Notes.`
										: `Waiting for ${card.run.bot.name} to pick this up (asked ${card.run.since === "just now" ? "just now" : `${card.run.since} ago`}). The Bot checks on its routine.`}
								</span>
							</p>
						) : null}

						<section className="text-block" aria-labelledby="details-label">
							<div className="block-head">
								<h3 id="details-label">Details</h3>
								{body && !editingBody ? (
									<button type="button" className="ghost small" onClick={() => setEditingBody(true)}>
										Edit
									</button>
								) : null}
								{body && editingBody ? (
									<button type="button" className="ghost small" onClick={() => setEditingBody(false)}>
										Preview
									</button>
								) : null}
							</div>
							{editingBody ? (
								<GrowingText value={body} onChange={setBody} className="body-input" minRows={wide ? 18 : 12} placeholder="What the bot reported, steps, context" autoFocus={Boolean(card)} />
							) : (
								<div className="prose" lang="ja" onDoubleClick={() => setEditingBody(true)}>
									<Prose text={body} />
								</div>
							)}
						</section>

						<section className="text-block" aria-labelledby="notes-label">
							<div className="block-head">
								<h3 id="notes-label">Notes</h3>
								{!editingNotes ? (
									<button type="button" className="ghost small" onClick={() => setEditingNotes(true)}>
										{notes ? "Edit" : "Add note"}
									</button>
								) : null}
							</div>
							{editingNotes ? (
								<GrowingText value={notes} onChange={setNotes} className="notes-input" minRows={5} placeholder="Bots sign their notes here" autoFocus />
							) : notes ? (
								<NotesLog notes={notes} />
							) : (
								<p className="muted small">No notes yet.</p>
							)}
						</section>
					</div>

					<aside className="drawer-side" aria-label="Card details">
						<div className="side-group">
							<AssigneePicker members={members} selected={assignees} onChange={setAssignees} />
							{members.length <= 1 ? <p className="muted small">Bots appear here once they use the board, or add one under Bots & MCP.</p> : null}
						</div>

						<fieldset className="side-group field">
							<legend>Priority</legend>
							<div className="segmented" role="radiogroup" aria-label="Priority">
								{PRIORITIES.map((item) => (
									<button key={item.id} type="button" role="radio" aria-checked={priority === item.id} className={priority === item.id ? `on p-${item.id}` : ""} onClick={() => setPriority(item.id)}>
										{item.label}
									</button>
								))}
							</div>
						</fieldset>

						{card && (card.links.pr || card.links.agent || card.originalLink) ? (
							<div className="side-group">
								<p className="side-label">Links</p>
								<ul className="link-list">
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
												Past Cursor agent
											</a>
										</li>
									) : null}
								</ul>
							</div>
						) : null}

						<details className="side-group more-fields" open={!card || wide}>
							<summary>More fields</summary>
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
						</details>
					</aside>
				</div>

				<footer className="drawer-foot">
					{card && !dirty ? <span className="muted small">No unsaved changes</span> : <span className="muted small">{card ? "Unsaved changes" : "Lands in Inbox"} · ⌘ Enter to save</span>}
					<span className="foot-actions">
						<button type="button" className="ghost" onClick={onClose}>
							{card && !dirty ? "Close" : "Cancel"}
						</button>
						<button type="submit" className="primary" disabled={busy || !title.trim() || (card !== null && !dirty)}>
							{card ? "Save changes" : "Add to Inbox"}
						</button>
					</span>
				</footer>
			</form>
		</div>
	);
}

/**
 * Run hands the card to a Grok Bot. The menu lists the card's bots first, then the rest of the roster;
 * a pending or working run shows here with Cancel run.
 */
function RunMenu({ card, members, send }: { card: CardView; members: readonly MemberView[]; send: (command: Command) => Promise<boolean> }) {
	const bots = members.filter((member) => member.kind === "bot");
	const run = card.run;
	if (!run && !RUNNABLE.includes(card.column)) return null;
	const verb = card.column === "inProgress" ? "Re-run" : "Run";
	// A Bot already on the card runs it straight away; the menu is only for choosing one.
	const runner = runnerOf(
		card.assignees.map((member) => member.id),
		bots,
	);
	if (!run && runner) {
		return (
			<button type="button" className="run-button" title={`${verb} with ${runner.name}`} onClick={() => void send({ type: "run", cardId: card.id, bot: runner.id })}>
				<svg className="play" viewBox="0 0 10 12" aria-hidden="true">
					<path d="M1 1l8 5-8 5z" />
				</svg>
				<span>{verb}</span>
			</button>
		);
	}
	return (
		<Menu
			align="start"
			trigger={
				<button
					type="button"
					className={`run-button${run ? ` ${run.status}` : ""}`}
					aria-label={run ? `Run: ${run.status === "working" ? `${run.bot.name} working` : `waiting for ${run.bot.name}`}` : `${verb} with a Grok Bot`}
				>
					{run ? <MemberAvatar member={run.bot} size={18} /> : <svg className="play" viewBox="0 0 10 12" aria-hidden="true"><path d="M1 1l8 5-8 5z" /></svg>}
					<span>{run ? (run.status === "working" ? "Running" : "Requested") : verb}</span>
					<svg className="caret" viewBox="0 0 10 6" aria-hidden="true">
						<path d="M1 1l4 4 4-4" />
					</svg>
				</button>
			}
		>
			{run ? (
				<>
					<MenuNote>{run.status === "working" ? `${run.bot.name} is on it.` : `${run.bot.name} has not picked it up yet.`}</MenuNote>
					<MenuItem danger onSelect={() => void send({ type: "stop", cardId: card.id })}>
						Cancel run
					</MenuItem>
				</>
			) : (
				<>
					<MenuTitle>{verb} with</MenuTitle>
					{bots.length === 0 ? <MenuNote>No bots yet. Connect one under Bots & MCP.</MenuNote> : null}
					{bots.map((bot) => (
						<MenuItem key={bot.id} onSelect={() => void send({ type: "run", cardId: card.id, bot: bot.id })}>
							<MemberAvatar member={bot} size={20} />
							<span lang="ja">{bot.name}</span>
						</MenuItem>
					))}
				</>
			)}
		</Menu>
	);
}

/** The card's column as a button that opens a menu of the other columns, like an issue's status. */
function StatusMenu({ column, onMove }: { column: Column; onMove: (to: Column) => void }) {
	const label = COLUMNS.find((item) => item.id === column)?.label ?? column;
	return (
		<Menu
			align="start"
			trigger={
				<button type="button" className={`status-button col-${column}`} aria-label={`Status: ${label}. Move to another column`}>
					<span className="lamp" aria-hidden="true" />
					<span>{label}</span>
					<svg className="caret" viewBox="0 0 10 6" aria-hidden="true">
						<path d="M1 1l4 4 4-4" />
					</svg>
				</button>
			}
		>
			<MenuTitle>Move to</MenuTitle>
			{COLUMNS.map((item) => (
				<MenuItem key={item.id} current={item.id === column} onSelect={() => item.id !== column && onMove(item.id)}>
					<span className={`lamp col-${item.id}`} aria-hidden="true" />
					{item.label}
					{item.id === column ? <span className="menu-check" aria-hidden="true">✓</span> : null}
				</MenuItem>
			))}
		</Menu>
	);
}

function DotsIcon() {
	return (
		<svg viewBox="0 0 16 4" aria-hidden="true" className="dots">
			<circle cx="2" cy="2" r="1.6" />
			<circle cx="8" cy="2" r="1.6" />
			<circle cx="14" cy="2" r="1.6" />
		</svg>
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
		<textarea
			ref={node}
			className={className}
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
	if (!text.trim()) return <p className="muted">No details yet. Double-click or press Edit to add them.</p>;
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
		<ol className="notes-log" lang="ja">
			{entries.map((entry, index) => (
				<li key={index}>
					{entry.author ? (
						<p className="note-meta">
							<strong>{entry.author}</strong>
							<time>{entry.stamp}</time>
						</p>
					) : null}
					<p className="note-text">
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

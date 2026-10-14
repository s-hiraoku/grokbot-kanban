"use client";

import { useEffect, useMemo, useState } from "react";
import CardPanel from "@/components/CardPanel";
import type { BoardView, CardView } from "@/lib/view";
import type { Column, ParkColumn } from "@/lib/domain";

type Command =
	| { type: "create"; content: Record<string, unknown> }
	| { type: "edit"; cardId: string; patch: Record<string, unknown> }
	| { type: "move"; cardId: string; to: ParkColumn }
	| { type: "run"; cardId: string }
	| { type: "stop"; cardId: string };

export default function Board({ initial, studioUrl }: { initial: BoardView; studioUrl: string | null }) {
	const [board, setBoard] = useState(initial);
	const [toast, setToast] = useState<string | null>(null);
	const [composer, setComposer] = useState(false);
	const cards = useMemo(() => board.columns.flatMap((column) => column.cards), [board]);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 4200);
		return () => window.clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		const live = board.agents.running + board.agents.queued > 0;
		if (!live) return;
		const timer = window.setInterval(() => {
			void refresh();
		}, 4000);
		return () => window.clearInterval(timer);
	}, [board.agents.running, board.agents.queued]);

	async function refresh() {
		const response = await fetch("/api/owner/sync", { method: "POST" });
		if (response.status === 401) {
			window.location.href = "/login";
			return;
		}
		if (!response.ok) return;
		setBoard((await response.json()) as BoardView);
	}

	async function send(command: Command) {
		const response = await fetch("/api/owner/commands", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(command),
		});
		if (response.status === 401) {
			window.location.href = "/login";
			return;
		}
		const payload = (await response.json()) as { board?: BoardView; notice?: string | null; error?: string };
		if (payload.board) setBoard(payload.board);
		if (payload.notice) setToast(payload.notice);
	}

	function onDrop(columnId: Column, cardId: string) {
		const card = cards.find((item) => item.id === cardId);
		if (!card) return;
		if (columnId === "inProgress" || columnId === "inReview") return;
		if (columnId === "todo" && card.column !== "todo" && card.action.command === "run" && card.action.enabled) {
			void send({ type: "run", cardId });
			return;
		}
		if ((card.moveTargets as readonly string[]).includes(columnId) && columnId !== card.column) {
			void send({ type: "move", cardId, to: columnId });
		}
	}

	return (
		<div className="shell">
			<header className="top">
				<a className="studio" href={studioUrl ?? "#"}>
					← Studio
				</a>
				<h1>Grok Bot</h1>
				<div className="top-actions">
					<button type="button" className="ghost" onClick={() => setComposer((open) => !open)}>
						New card
					</button>
					<form method="post" action="/api/auth/logout">
						<button type="submit" className="ghost">
							Sign out
						</button>
					</form>
					<p className="agents">
						Agents {board.agents.running}/{board.agents.capacity} running
					</p>
				</div>
			</header>
			{composer ? <Composer onCreate={(content) => void send({ type: "create", content })} onClose={() => setComposer(false)} /> : null}
			<div className="columns">
				{board.columns.map((column) => (
					<section
						key={column.id}
						className="column"
						onDragOver={(event) => event.preventDefault()}
						onDrop={(event) => {
							event.preventDefault();
							onDrop(column.id, event.dataTransfer.getData("text/plain"));
						}}
					>
						<header>
							<span className="dot" style={{ background: column.dot }} />
							<h2>{column.label}</h2>
							<span className="count">{column.count}</span>
						</header>
						{column.cards.length === 0 ? <p className="empty">Nothing here</p> : null}
						{column.cards.map((card) => (
							<CardPanel
								key={card.id}
								card={card}
								onRun={() => void send({ type: "run", cardId: card.id })}
								onStop={() => void send({ type: "stop", cardId: card.id })}
								onMove={(to) => void send({ type: "move", cardId: card.id, to })}
								onEdit={(patch) => void send({ type: "edit", cardId: card.id, patch })}
							/>
						))}
					</section>
				))}
			</div>
			{toast ? <div className="toast">{toast}</div> : null}
		</div>
	);
}

function Composer({
	onCreate,
	onClose,
}: {
	onCreate: (content: Record<string, unknown>) => void;
	onClose: () => void;
}) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [repo, setRepo] = useState("");
	const [source, setSource] = useState("");
	const [originalLink, setOriginalLink] = useState("");
	const [notes, setNotes] = useState("");
	const [priority, setPriority] = useState("normal");
	const [kind, setKind] = useState("text");
	const [seconds, setSeconds] = useState("6");

	return (
		<form
			className="composer"
			onSubmit={(event) => {
				event.preventDefault();
				onCreate({
					title,
					body,
					notes,
					source: source || null,
					originalLink: originalLink || null,
					priority,
					repo: repo ? { url: repo, startingRef: "main" } : null,
					kind: kind === "voice" ? { type: "voice", seconds: Number(seconds) } : { type: "text" },
					screening: null,
				});
				onClose();
			}}
		>
			<label>
				Title
				<input value={title} onChange={(event) => setTitle(event.target.value)} required lang="ja" />
			</label>
			<label>
				Body
				<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} lang="ja" />
			</label>
			<label>
				Repo
				<input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/org/repo" />
			</label>
			<label>
				Source
				<input value={source} onChange={(event) => setSource(event.target.value)} />
			</label>
			<label>
				Original link
				<input value={originalLink} onChange={(event) => setOriginalLink(event.target.value)} placeholder="https://" />
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
			<label>
				Notes
				<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} lang="ja" />
			</label>
			<div className="composer-actions">
				<button type="submit">Add to Inbox</button>
				<button type="button" className="ghost" onClick={onClose}>
					Cancel
				</button>
			</div>
		</form>
	);
}

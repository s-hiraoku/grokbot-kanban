"use client";

import { useEffect, useState } from "react";
import { MemberAvatar } from "@/components/Avatar";
import type { Command } from "@/components/Board";
import type { BotView } from "@/lib/view";

const PALETTE = ["#7aa2ff", "#3dd68c", "#e2b340", "#e06c75", "#c678dd", "#56b6c2", "#f0883e", "#a3be8c"];

type Draft = { id: string | null; name: string; role: string; avatar: string; color: string };

export default function BotsPanel({
	bots,
	onClose,
	send,
}: {
	bots: readonly BotView[];
	onClose: () => void;
	send: (command: Command) => Promise<boolean>;
}) {
	const [tab, setTab] = useState<"roster" | "connect">(bots.length ? "roster" : "connect");
	const [draft, setDraft] = useState<Draft | null>(null);
	const [origin, setOrigin] = useState("");
	useEffect(() => setOrigin(window.location.origin), []);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const mcpUrl = `${origin}/api/mcp`;
	const grokMessage = `カスタムMCPサーバーを追加してください。名前は kanban、Remote HTTPS で URL は ${mcpUrl} です。
認証は API キーのヘッダーです。ヘッダー名は Authorization、値は「Bearer <BOT_TOKEN>」です（キーは URL に入れないでください）。
追加したら tools/list の結果を短く報告してください。以後このカンバンを使うときは、ツールの bot 引数に必ずあなたの Bot 名を入れてください。`;
	const skillMessage = `「Kanban 運用」という Skill を保存してください。
- 仕事を始める前に kanban の board_summary を呼び、自分に割り当てられたカードを確認する
- 手を付けるカードは assign_card で自分に割り当ててから作業する
- 調べた事実、証拠リンク、残る不確実性は add_note でカードに残す。事実と仮説を分ける
- 新しい依頼や不具合報告は create_card で Inbox に起票する。X の投稿なら externalId に投稿 ID を入れる
- 別の Bot に渡すときは assign_card の add にその Bot 名を入れ、add_note で引き継ぎ内容を書く
- 作業が進んだら move_card でカードを動かし、reason に理由を書く（完了は done、見送りは wontDo、着手可能になったら todo）
- Cursor エージェントの起動と停止はオーナーの承認事項なので、頼まれても行わない。待機中・実行中のカードは動かさない
まだ Routine は作らないでください。`;
	const apiSnippet = `{
  "type": "mcp",
  "server_label": "kanban",
  "server_url": "${mcpUrl}",
  "authorization": "<BOT_TOKEN>",
  "allowed_tools": ["board_summary", "list_cards", "get_card"]
}`;

	return (
		<div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="modal bots" role="dialog" aria-modal="true" aria-label="Bots and MCP">
				<header className="modal-head">
					<h2>Bots & MCP</h2>
					<div className="tabs" role="tablist">
						<button type="button" role="tab" aria-selected={tab === "roster"} className={tab === "roster" ? "on" : ""} onClick={() => setTab("roster")}>
							Roster
						</button>
						<button type="button" role="tab" aria-selected={tab === "connect"} className={tab === "connect" ? "on" : ""} onClick={() => setTab("connect")}>
							Connect Grok Bot
						</button>
					</div>
					<button type="button" className="icon" aria-label="Close" onClick={onClose}>
						×
					</button>
				</header>
				{tab === "roster" ? (
					<div className="roster-list">
						{bots.length === 0 ? <p className="muted">No bots yet. A Grok Bot joins the roster the first time it calls the board with its name.</p> : null}
						{bots.map((bot) =>
							draft?.id === bot.id ? (
								<BotForm key={bot.id} draft={draft} setDraft={setDraft} onSave={async () => (await save(draft)) && setDraft(null)} onCancel={() => setDraft(null)} />
							) : (
								<div key={bot.id} className="bot-row">
									<MemberAvatar member={bot} size={34} />
									<div className="bot-info">
										<strong>{bot.name}</strong>
										<span className="muted small">{bot.role || "No role yet"}</span>
										<span className="bot-stats">
											<span>{bot.assigned} assigned</span>
											<span>{bot.created} filed</span>
											<span>{bot.lastSeen === null ? "Not seen yet" : bot.lastSeen === "just now" ? "Seen just now" : `Seen ${bot.lastSeen} ago`}</span>
										</span>
									</div>
									<button
										type="button"
										className="ghost small"
										onClick={() => setDraft({ id: bot.id, name: bot.name, role: bot.role, avatar: bot.avatar ?? "", color: bot.color })}
									>
										Edit
									</button>
									<button
										type="button"
										className="ghost small danger"
										onClick={() => {
											if (window.confirm(`Remove ${bot.name} from the roster? Its cards stay, unassigned from it.`)) void send({ type: "deleteBot", id: bot.id });
										}}
									>
										Remove
									</button>
								</div>
							),
						)}
						{draft?.id === null ? (
							<BotForm draft={draft} setDraft={setDraft} onSave={async () => (await save(draft)) && setDraft(null)} onCancel={() => setDraft(null)} />
						) : (
							<button type="button" className="ghost" onClick={() => setDraft({ id: null, name: "", role: "", avatar: "", color: PALETTE[bots.length % PALETTE.length] ?? PALETTE[0]! })}>
								＋ Add bot
							</button>
						)}
						<p className="muted small">
							Use the same name as the Grok Bot profile. The icon is one emoji or an https image URL, for example the avatar you set in Edit Profile.
						</p>
					</div>
				) : (
					<div className="connect">
						<ol>
							<li>
								Copy the board token from <code>BOT_TOKEN</code> in your deployment settings. Never paste it into a public chat or a shared Bot description.
							</li>
							<li>
								In Grok Bot, send this to the Bot that should use the board. It adds a <strong>Remote HTTPS</strong> custom server, which Grok Bot recommends for servers that need a secret.
								<CopyBlock text={grokMessage} />
							</li>
							<li>
								When it asks for the key, give the header name <code>Authorization</code> and the value <code>Bearer &lt;BOT_TOKEN&gt;</code>. Check it under Settings → Plugins → Yours.
							</li>
							<li>
								Optional: save the working rules as a Skill so every Bot uses the board the same way.
								<CopyBlock text={skillMessage} />
							</li>
						</ol>
						<h3>Endpoint</h3>
						<CopyBlock text={mcpUrl} />
						<p className="muted small">
							Streamable HTTP, stateless, JSON responses. Read tools are marked read-only so Auto-review can let them through. Bots can file, edit, assign, annotate, and move cards between Inbox, Todo, Done, and Won't Do. Starting and stopping Cursor agents stays with you.
						</p>
						<h3>xAI API</h3>
						<p className="muted small">The same server works as a remote MCP tool in the Responses API. Limit it to read tools when a script only needs to look.</p>
						<CopyBlock text={apiSnippet} />
					</div>
				)}
			</div>
		</div>
	);

	async function save(value: Draft): Promise<boolean> {
		return send({
			type: "saveBot",
			id: value.id,
			profile: { name: value.name, role: value.role, avatar: value.avatar.trim() || null, color: value.color },
		});
	}
}

function BotForm({
	draft,
	setDraft,
	onSave,
	onCancel,
}: {
	draft: Draft;
	setDraft: (draft: Draft) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	const preview = {
		id: draft.id ?? "new",
		name: draft.name || "New bot",
		kind: "bot" as const,
		avatar: draft.avatar.trim() || null,
		color: draft.color,
		initials: (draft.name || "NB").slice(0, 2).toUpperCase(),
	};
	return (
		<form
			className="bot-form"
			onSubmit={(event) => {
				event.preventDefault();
				onSave();
			}}
		>
			<MemberAvatar member={preview} size={34} />
			<label>
				Name
				<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={40} lang="ja" />
			</label>
			<label>
				Role
				<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} maxLength={200} lang="ja" placeholder="Bug Reproduction" />
			</label>
			<label>
				Icon
				<input value={draft.avatar} onChange={(event) => setDraft({ ...draft, avatar: event.target.value })} placeholder="🐞 or https://…" />
			</label>
			<div className="palette" role="radiogroup" aria-label="Color">
				{PALETTE.map((color) => (
					<button
						key={color}
						type="button"
						role="radio"
						aria-checked={draft.color === color}
						className={draft.color === color ? "swatch on" : "swatch"}
						style={{ background: color }}
						onClick={() => setDraft({ ...draft, color })}
					/>
				))}
			</div>
			<div className="row">
				<button type="submit" className="primary small">
					Save
				</button>
				<button type="button" className="ghost small" onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	);
}

function CopyBlock({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="copy-block">
			<pre lang="ja">{text}</pre>
			<button
				type="button"
				className="ghost small"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(text);
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1500);
					} catch {
						setCopied(false);
					}
				}}
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}

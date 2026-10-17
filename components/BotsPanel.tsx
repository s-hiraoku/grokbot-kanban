"use client";

import { CheckIcon, CopyIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/Avatar";
import type { Command } from "@/components/Board";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ToastMessage } from "@/lib/notify";
import type { BotView, MemberView } from "@/lib/view";

const PALETTE = ["#7aa2ff", "#3dd68c", "#e2b340", "#e06c75", "#c678dd", "#56b6c2", "#f0883e", "#a3be8c"];

type Draft = { id: string | null; name: string; role: string; avatar: string; color: string; original: string };

export default function BotsPanel({
	open,
	bots,
	owner,
	onClose,
	send,
	notify,
}: {
	bots: readonly BotView[];
	owner: MemberView;
	open: boolean;
	onClose: () => void;
	send: (command: Command) => Promise<boolean>;
	notify: (message: ToastMessage) => void;
}) {
	const [tab, setTab] = useState<"roster" | "connect">(bots.length ? "roster" : "connect");
	const [draft, setDraft] = useState<Draft | null>(null);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
	const [origin, setOrigin] = useState("");
	useEffect(() => setOrigin(window.location.origin), []);

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
- 作業が進んだら move_card でカードを動かし、reason に理由を書く（着手したら inProgress、確認待ちは inReview、完了は done、見送りは wontDo、着手可能になったら todo）
- 自分宛ての Run 依頼は list_run_requests で確認し、start_run → 作業 → finish_run の順で進める。取りまとめ役の Bot から Run の依頼が届いたときも同じ手順で進める`;
	// One Bot runs the routine and passes each request on with SendToAgent, so the other Bots need no routine.
	const routineMessage = `「Kanban Run」という Routine を作ってください。あなたが全 Bot の Run 依頼の取りまとめ役です。
- スケジュール: 5 分ごと
- 毎回やること: kanban の list_run_requests を bot にあなたの Bot 名、everyone を true にして呼ぶ。status が requested のものだけを古い順に扱い、0 件なら何もしないで終わる
- run.bot があなた自身の依頼: start_run を呼ぶ → get_card で内容を読む → 書かれている作業をする → 途中経過は add_note に残す → finish_run を呼ぶ（完了は done、オーナーの確認が要るなら review、進められないなら blocked）。summary には、やったこと・結果のリンク・残っていることを書く
- run.bot が別の Bot の依頼で run.passedOnBy が空: SendToAgent でその Bot に依頼を送り、送ったら pass_run（note に送った方法）を呼ぶ。本文は次のとおり:
  「kanban のカード <カード ID>「<タイトル>」の Run をお願いします。kanban の start_run を bot にあなたの Bot 名、card にこの ID を入れて呼び、get_card で内容を読んで作業し、途中経過は add_note に、最後に finish_run（done / review / blocked と summary）で結果を残してください。コード変更が要るなら hand_off_to_cursor で Cursor に渡してください。返事は不要です。結果はカードに残ります」
- run.passedOnAt から 60 分たっても requested のままなら、同じ本文で 1 回だけ送り直して pass_run を呼ぶ。それでも動かなければ add_note に状況を残す
- 承認が要る操作は、いつも通り私に確認してから進める
- finish_run が「run がない」と返したら、オーナーが取り消したので作業を止めて add_note に状況を残す
- 自分の依頼でリポジトリのコード変更が必要なら、自分で finish_run せずに hand_off_to_cursor で Cursor エージェントに渡す。カードに repo がなければ先に update_card で設定し、instructions には調べたこと・関係するファイル・確認方法を書く
作ったら、テスト実行をせずに Routine の内容を短く報告してください。すでに「Kanban Run」があれば、この内容に置き換えてください。`;
	const iconMessage = `あなたのプロフィール画像を kanban に登録してください。
1. 下に添付した画像（あなたの Edit Profile のアイコンと同じもの）をファイルに保存する
2. コンピューターで正方形に切り抜いて 128px に縮小し、PNG か WebP にする（90 KB 未満）
3. base64 にして「data:image/png;base64,...」の形にし、kanban の update_my_profile の avatar に渡す（bot 引数はあなたの Bot 名）
終わったら、返ってきた avatar の URL を教えてください。`;
	const apiSnippet = `{
  "type": "mcp",
  "server_label": "kanban",
  "server_url": "${mcpUrl}",
  "authorization": "<BOT_TOKEN>",
  "allowed_tools": ["board_summary", "list_cards", "get_card"]
}`;

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="top-[6vh] max-h-[88dvh] translate-y-0 gap-0 overflow-y-auto bg-deck p-0 [--surface:var(--deck)] sm:max-w-[720px]" aria-describedby={undefined} showCloseButton={false}>
				<Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="gap-0">
					<DialogHeader className="sticky top-0 z-10 flex-row flex-wrap items-center gap-3 border-b bg-deck px-5 py-4 pr-14 text-left">
						<DialogTitle className="font-display text-lg">Bots & MCP</DialogTitle>
						<TabsList>
							<TabsTrigger value="roster">Roster</TabsTrigger>
							<TabsTrigger value="connect">Connect Grok Bot</TabsTrigger>
						</TabsList>
						{/* In the sticky header, so it stays in reach while the roster scrolls. */}
						<DialogClose asChild>
							<Button variant="ghost" size="icon-sm" className="absolute top-3.5 right-3.5" aria-label="Close">
								<XIcon />
							</Button>
						</DialogClose>
					</DialogHeader>
					<TabsContent value="roster" className="grid gap-2 p-5">
						<div className="flex flex-wrap items-center gap-3 rounded-xl border bg-deck-2 px-3 py-2.5 [--surface:var(--deck-2)]">
							<MemberAvatar member={owner} size={34} />
							<div className="mr-auto grid min-w-0 gap-0.5">
								<strong>Your icon</strong>
								<span className="text-xs text-muted-foreground">Shown on the cards you file or hold</span>
							</div>
							<UploadButton
								label="Upload image"
								onFile={async (file) => {
									const avatar = await shrinkImage(file).catch(() => null);
									if (avatar) void send({ type: "setOwnerAvatar", avatar });
									else notify({ text: "That image could not be read. Try a PNG, JPEG, WebP or GIF.", tone: "error" });
								}}
							/>
							<Button type="button" variant="ghost" size="sm" onClick={() => void send({ type: "setOwnerAvatar", avatar: null })}>
								Default
							</Button>
						</div>
						{bots.length === 0 ? (
							<p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
								No bots yet. A Grok Bot joins the roster the first time it calls the board with its name.{" "}
								<button type="button" className="text-primary underline underline-offset-3" onClick={() => setTab("connect")}>
									Connect one
								</button>
							</p>
						) : null}
						{bots.map((bot) =>
							draft?.id === bot.id ? (
								<BotForm key={bot.id} draft={draft} setDraft={setDraft} onSave={async () => (await save(draft)) && setDraft(null)} onCancel={() => setDraft(null)} notify={notify} />
							) : (
								<div key={bot.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-deck-2 px-3 py-2.5 [--surface:var(--deck-2)]">
									<MemberAvatar member={bot} size={34} />
									<div className="mr-auto grid min-w-0 gap-0.5">
										<strong lang="ja">{bot.name}</strong>
										<span className="text-xs text-muted-foreground" lang="ja">
											{bot.role || "No role yet"}
										</span>
										<span className="flex flex-wrap gap-3 text-xs text-faint">
											<span>{bot.assigned} assigned</span>
											<span>{bot.created} filed</span>
											<span>{bot.lastSeen === null ? "Not seen yet" : bot.lastSeen === "just now" ? "Seen just now" : `Seen ${bot.lastSeen} ago`}</span>
										</span>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setDraft({ id: bot.id, name: bot.name, role: bot.role, avatar: bot.avatar ?? "", color: bot.color, original: bot.avatar ?? "" })}
									>
										Edit
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive"
										onClick={() =>
											setConfirm({
												title: `Remove ${bot.name}?`,
												description: "Its cards stay on the board, unassigned from it. It joins the roster again the next time it calls the board.",
												action: "Remove bot",
												danger: true,
												onConfirm: () => send({ type: "deleteBot", id: bot.id }),
											})
										}
									>
										Remove
									</Button>
								</div>
							),
						)}
						{draft?.id === null ? (
							<BotForm draft={draft} setDraft={setDraft} onSave={async () => (await save(draft)) && setDraft(null)} onCancel={() => setDraft(null)} notify={notify} />
						) : (
							<Button
								type="button"
								variant="outline"
								className="justify-self-start"
								onClick={() => setDraft({ id: null, name: "", role: "", avatar: "", color: PALETTE[bots.length % PALETTE.length] ?? PALETTE[0]!, original: "" })}
							>
								<PlusIcon />
								Add bot
							</Button>
						)}
						<p className="text-xs text-muted-foreground">
							Use the same name as the Grok Bot profile. The icon is one emoji or an https image URL, for example the avatar you set in Edit Profile.
						</p>
					</TabsContent>
					<TabsContent value="connect" className="p-5 text-sm leading-relaxed [&_code]:rounded-sm [&_code]:bg-background [&_code]:px-1.5 [&_code]:py-px [&_code]:text-xs">
						<ol className="mb-4 grid list-decimal gap-3.5 pl-5">
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
							<li>
								For <strong>Run</strong>: the board cannot wake a Bot, so one Bot checks for every Bot&apos;s runs on a routine and passes each on to the Bot it is for. Send this to that one Bot only; the others need no routine. A Run reaches its Bot within about 5 minutes, and later if that Bot is busy. The card shows who passed it on.
								<CopyBlock text={routineMessage} />
							</li>
							<li>
								Optional: let the Bot set its own icon. Grok Bot does not share profile images with connectors, so attach the Bot&apos;s icon image to this message. You can also upload it yourself under Roster.
								<CopyBlock text={iconMessage} />
							</li>
						</ol>
						<h3 className="mt-5 mb-1.5 font-display text-[15px] font-semibold">Endpoint</h3>
						<CopyBlock text={mcpUrl} />
						<p className="mt-2 text-xs text-muted-foreground">
							Streamable HTTP, stateless, JSON responses. Read tools are marked read-only so Auto-review can let them through. Bots can file, edit, assign, annotate, and move cards to any column. Only you can delete a card.
						</p>
						<h3 className="mt-5 mb-1.5 font-display text-[15px] font-semibold">xAI API</h3>
						<p className="text-xs text-muted-foreground">The same server works as a remote MCP tool in the Responses API. Limit it to read tools when a script only needs to look.</p>
						<CopyBlock text={apiSnippet} />
					</TabsContent>
				</Tabs>
			</DialogContent>
			<ConfirmDialog request={confirm} onDone={() => setConfirm(null)} />
		</Dialog>
	);

	async function save(value: Draft): Promise<boolean> {
		return send({
			type: "saveBot",
			id: value.id,
			// An unchanged icon is left out so an uploaded image is kept as stored.
			profile: {
				name: value.name,
				role: value.role,
				...(value.id && value.avatar === value.original ? {} : { avatar: value.avatar.trim() || null }),
				color: value.color,
			},
		});
	}
}

function BotForm({
	draft,
	setDraft,
	onSave,
	onCancel,
	notify,
}: {
	draft: Draft;
	setDraft: (draft: Draft) => void;
	onSave: () => void;
	onCancel: () => void;
	notify: (message: ToastMessage) => void;
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
			className="grid grid-cols-[auto_1fr] items-end gap-3 rounded-xl border border-primary p-3 sm:grid-cols-[auto_1fr_1fr_1fr]"
			aria-label={draft.id ? `Edit ${draft.name}` : "New bot"}
			onSubmit={(event) => {
				event.preventDefault();
				onSave();
			}}
		>
			<MemberAvatar member={preview} size={34} className="self-center" />
			<label className="grid gap-1 text-xs font-bold text-muted-foreground">
				Name
				<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={40} lang="ja" autoFocus />
			</label>
			<label className="col-span-2 grid gap-1 text-xs font-bold text-muted-foreground sm:col-span-1">
				Role
				<Input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} maxLength={200} lang="ja" placeholder="Bug Reproduction" />
			</label>
			<div className="col-span-2 grid gap-1 text-xs font-bold text-muted-foreground sm:col-span-1">
				<span>Icon</span>
				<div className="flex items-center gap-2">
					{isImage(draft.avatar) ? (
						<span className="flex flex-1 items-center gap-2 font-normal text-foreground">
							Image set
							<button type="button" className="text-primary underline underline-offset-3" onClick={() => setDraft({ ...draft, avatar: "" })}>
								Remove
							</button>
						</span>
					) : (
						<Input aria-label="Icon" value={draft.avatar} onChange={(event) => setDraft({ ...draft, avatar: event.target.value })} placeholder="🐞 or https://…" />
					)}
					<UploadButton
						label="Upload"
						onFile={async (file) => {
							const avatar = await shrinkImage(file).catch(() => null);
							if (avatar) setDraft({ ...draft, avatar });
							else notify({ text: "That image could not be read. Try a PNG, JPEG, WebP or GIF.", tone: "error" });
						}}
					/>
				</div>
			</div>
			<div className="col-span-full flex flex-wrap gap-1.5 sm:col-start-2" role="radiogroup" aria-label="Color">
				{PALETTE.map((color) => (
					<button
						key={color}
						type="button"
						role="radio"
						aria-checked={draft.color === color}
						aria-label={color}
						className={cn("size-6 rounded-full border-2 border-transparent", draft.color === color && "border-foreground")}
						style={{ background: color }}
						onClick={() => setDraft({ ...draft, color })}
					/>
				))}
			</div>
			<div className="col-span-full flex gap-2 sm:col-start-2">
				<Button type="submit" size="sm">
					Save
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}

/** A button that opens the file picker; the hidden input stays out of the tab order. */
function UploadButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
				<UploadIcon />
				{label}
			</Button>
			<input
				ref={input}
				type="file"
				hidden
				accept="image/png,image/jpeg,image/webp,image/gif"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) onFile(file);
				}}
			/>
		</>
	);
}

function CopyBlock({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="relative mt-2">
			<pre className="m-0 rounded-lg border bg-background py-3 pr-24 pl-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap" lang="ja">
				{text}
			</pre>
			<Button
				type="button"
				variant="outline"
				size="xs"
				className="absolute top-2 right-2"
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
				{copied ? <CheckIcon /> : <CopyIcon />}
				{copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
}

function isImage(value: string): boolean {
	return /^(https:\/\/|\/api\/avatar\/|data:image\/)/.test(value);
}

/** Crops to a square and scales to 128px, so a saved icon is a few KB however large the upload was. */
async function shrinkImage(file: File): Promise<string> {
	const bitmap = await createImageBitmap(file);
	const side = Math.min(bitmap.width, bitmap.height);
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("no canvas");
	context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
	bitmap.close();
	const webp = canvas.toDataURL("image/webp", 0.86);
	return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

"use client";

import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConfirmRequest } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BotTokenInfo } from "@/lib/accounts";
import type { ToastMessage } from "@/lib/notify";

/**
 * The connector tokens of the signed-in user's board. A new token is shown once, right after it is made; the board
 * keeps only its hash. Revoking one refuses the next call that uses it.
 */
export function BotTokens({ notify, confirm }: { notify: (message: ToastMessage) => void; confirm: (request: ConfirmRequest) => void }) {
	const [tokens, setTokens] = useState<BotTokenInfo[] | null>(null);
	const [label, setLabel] = useState("");
	const [made, setMade] = useState<{ token: string; label: string } | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		void call("/api/owner/tokens", { method: "GET" }).then((body) => live && body && setTokens(body.tokens));
		return () => {
			live = false;
		};
	}, []);

	async function call(url: string, init: RequestInit): Promise<{ tokens: BotTokenInfo[]; token?: string; info?: BotTokenInfo } | null> {
		try {
			const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
			if (response.status === 401) {
				window.location.href = "/login";
				return null;
			}
			const body = await response.json();
			if (!response.ok) {
				notify({ text: body.message ?? "The board refused that. Try again.", tone: "error" });
				return null;
			}
			return body;
		} catch {
			notify({ text: "The board could not be reached. Check your connection and try again.", tone: "error" });
			return null;
		}
	}

	async function create() {
		setBusy(true);
		const body = await call("/api/owner/tokens", { method: "POST", body: JSON.stringify({ label }) });
		setBusy(false);
		if (!body?.token || !body.info) return;
		setMade({ token: body.token, label: body.info.label });
		setTokens((current) => [...(current ?? []), body.info!]);
		setLabel("");
	}

	return (
		<div className="mt-2 grid gap-2" data-slot="bot-tokens">
			{made ? (
				<div className="grid gap-1.5 rounded-lg border border-primary bg-background p-3" role="status" aria-label="New token">
					<strong className="text-[13px]">Copy the token for “{made.label}” now</strong>
					<span className="text-xs text-muted-foreground">It is shown only this once. If you lose it, make another and revoke this one.</span>
					<TokenValue token={made.token} />
					<Button type="button" variant="ghost" size="xs" className="justify-self-start" onClick={() => setMade(null)}>
						Done
					</Button>
				</div>
			) : null}
			<form
				className="flex flex-wrap gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<Input aria-label="Token name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Grok Bot" maxLength={40} className="h-8 max-w-60 flex-1 bg-background text-sm dark:bg-background" />
				<Button type="submit" size="sm" disabled={busy}>
					<KeyRoundIcon />
					Make a token
				</Button>
			</form>
			{tokens === null ? (
				<p className="text-xs text-muted-foreground">Loading tokens…</p>
			) : tokens.length === 0 ? (
				<p className="text-xs text-muted-foreground">No tokens yet. Make one for your Grok Bot connector.</p>
			) : (
				<ul className="m-0 grid list-none gap-1.5 p-0" aria-label="Tokens">
					{tokens.map((token) => (
						<li key={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2">
							<span className="mr-auto grid min-w-0 gap-0.5">
								<strong className="text-[13px]" lang="ja">
									{token.label}
								</strong>
								<span className="text-xs text-muted-foreground">
									Made {when(token.createdAt)} · {token.lastUsedAt === null ? "Not used yet" : `Last used ${when(token.lastUsedAt)}`}
								</span>
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="text-destructive hover:text-destructive"
								onClick={() =>
									confirm({
										title: `Revoke “${token.label}”?`,
										description: "A Grok Bot connector that uses this token is refused from its next call. Give it a new token to connect again.",
										action: "Revoke token",
										danger: true,
										onConfirm: async () => {
											const body = await call(`/api/owner/tokens/${token.id}`, { method: "DELETE" });
											if (body) setTokens(body.tokens);
										},
									})
								}
							>
								Revoke
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function TokenValue({ token }: { token: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center gap-2">
			<code className="min-w-0 flex-1 rounded-sm border bg-deck-2 px-2 py-1.5 font-mono text-xs break-all" data-slot="new-token">
				{token}
			</code>
			<Button
				type="button"
				variant="outline"
				size="xs"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(token);
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

function when(at: number): string {
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return new Date(at).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
}

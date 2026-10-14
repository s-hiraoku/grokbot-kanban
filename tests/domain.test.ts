import { expect, test } from "vitest";
import { transition, type Card, type CardId, type HttpsUrl, type Instant } from "@/lib/domain";

const repo = { url: "https://github.com/s-hiraoku/grokbot" as HttpsUrl, startingRef: "main" };

function card(state: Card["state"]): Card {
	return {
		id: "11111111-1111-4111-8111-111111111111" as CardId,
		createdAt: 0 as Instant,
		createdBy: null,
		rank: "0000000000001000",
		version: 0,
		content: {
			title: "件名",
			body: "本文",
			notes: "",
			repo,
			source: null,
			originalLink: null,
			priority: "normal",
			kind: { type: "text" },
			screening: null,
			assignees: [],
		},
		state,
	};
}

const ctx = { now: 10 as Instant, freshLaunchId: "launch-1" as never };

test("moving a card to Todo parks it and does not queue a run", () => {
	const next = transition(card({ kind: "idle", column: "inbox", last: null }), { type: "move", to: "todo" }, ctx);
	expect(next).toEqual({ kind: "changed", state: { kind: "idle", column: "todo", last: null } });
});

test("run queues a frozen prompt", () => {
	const next = transition(card({ kind: "idle", column: "inbox", last: null }), { type: "run" }, ctx);
	expect(next.kind).toBe("changed");
	if (next.kind !== "changed" || next.state.kind !== "queued") throw new Error("expected queued");
	expect(next.state.launch.request.promptText).toBe("# 件名\n\n本文");
	expect(next.state.launch.request.repo).toEqual(repo);
});

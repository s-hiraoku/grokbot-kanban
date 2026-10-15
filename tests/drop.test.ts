import { expect, test } from "vitest";
import { actionBlocked, dropHint, dropRefusal, dropRuns, dropTargets } from "@/lib/dropRules";
import type { CardView } from "@/lib/view";

const all = ["inbox", "todo", "inProgress", "inReview", "done", "wontDo"] as const;
const repo = { url: "https://github.com/a/b", startingRef: "main" };

function view(over: Partial<Pick<CardView, "column" | "moveTargets" | "action" | "repo" | "pill">> = {}) {
	return {
		column: "inbox" as const,
		moveTargets: all,
		action: { label: "Run" as const, command: "run" as const, enabled: true },
		repo: null,
		pill: null,
		...over,
	};
}

test("an idle card can be dropped on every column, In Progress and In Review included", () => {
	expect([...dropTargets(view())].sort()).toEqual([...all].sort());
});

test("a running card only reorders in place", () => {
	const running = view({ column: "inProgress", moveTargets: [], action: { label: "Stop", command: "stop", enabled: true }, pill: { label: "running", tone: "spinner" } });
	expect([...dropTargets(running)]).toEqual(["inProgress"]);
	expect(dropHint(running, "done")).toBe("Stop the agent first");
	expect(dropRefusal(running, "done")).toBe("Stop the agent before moving this card.");
});

test("a queued card cannot be pushed into In Progress by hand", () => {
	const queued = view({ column: "todo", action: { label: "Stop", command: "stop", enabled: true }, pill: { label: "queued", tone: "yellow" } });
	expect(dropTargets(queued).has("inProgress")).toBe(false);
	expect(dropTargets(queued).has("done")).toBe(true);
	expect(dropHint(queued, "inProgress")).toBe("Waiting for a slot");
	expect(dropRefusal(queued, "inProgress")).toBe("This card is already waiting for an agent slot.");
});

test("Todo and In Progress run the agent only when the card has a repo", () => {
	expect(dropRuns(view({ repo }), "inProgress")).toBe(true);
	expect(dropRuns(view({ repo }), "todo")).toBe(true);
	expect(dropRuns(view({ repo }), "inReview")).toBe(false);
	expect(dropRuns(view(), "inProgress")).toBe(false);
	expect(dropRuns(view({ repo, column: "inProgress" }), "inProgress")).toBe(false);
	expect(dropHint(view({ repo }), "inProgress")).toBe("Drop to run the agent");
	expect(dropHint(view(), "inProgress")).toBe("Drop to move, no agent");
	expect(dropHint(view(), "inReview")).toBeNull();
	expect(dropHint(view(), "inbox")).toBeNull();
});

test("a refused click always has a reason to show", () => {
	const idle = view({ repo });
	expect(actionBlocked(idle, "run")).toBeNull();
	expect(actionBlocked(idle, "delete")).toBeNull();
	expect(actionBlocked(idle, "move")).toBeNull();

	const running = view({ column: "inProgress", moveTargets: [], action: { label: "Stop", command: "stop", enabled: true }, pill: { label: "running", tone: "spinner" } });
	expect(actionBlocked(running, "stop")).toBeNull();
	expect(actionBlocked(running, "delete")).toBe("Stop the agent before deleting this card.");
	expect(actionBlocked(running, "move")).toBe("Stop the agent before moving this card.");

	const starting = view({ ...running, action: { label: "Stop", command: "stop", enabled: false } });
	expect(actionBlocked(starting, "stop")).toBe("The agent is starting or stopping. Try again in a moment.");

	const queued = view({ column: "todo", action: { label: "Stop", command: "stop", enabled: true }, pill: { label: "queued", tone: "yellow" } });
	expect(actionBlocked(queued, "move")).toBeNull();
	expect(actionBlocked(queued, "delete")).toBe("Stop the agent before deleting this card.");
});

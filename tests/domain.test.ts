import { expect, test } from "vitest";
import { columnOf, moved, type PastRun } from "@/lib/domain";
import { readState } from "@/lib/store";

test("a move changes only the column and keeps an old run's links", () => {
	const last = { kind: "ended", launchId: "l", endedAt: 1, agent: { agentId: "a", runId: "r", url: "https://cursor.com/agents/a" }, outcome: "finished", prUrl: null } as unknown as PastRun;
	expect(moved({ kind: "idle", column: "inbox", last: null, botRun: null, cursorRun: null }, "inProgress")).toEqual({ kind: "idle", column: "inProgress", last: null, botRun: null, cursorRun: null });
	expect(moved({ kind: "idle", column: "todo", last, botRun: null, cursorRun: null }, "done")).toEqual({ kind: "idle", column: "done", last, botRun: null, cursorRun: null });
	expect(moved({ kind: "idle", column: "todo", last: null, botRun: null, cursorRun: null }, "todo")).toBeNull();
});

test("states written for Cursor runs read back in the column they showed in", () => {
	const launch = { id: "l", requestedAt: 0, request: { promptText: "", repo: { url: "https://github.com/a/b", startingRef: "main" } } };
	const agent = { agentId: "a", runId: "r", url: "https://cursor.com/agents/a" };
	expect(columnOf(readState({ kind: "queued", launch, last: { kind: "launchFailed", launchId: "l", endedAt: 1, message: "no" } }))).toBe("todo");
	expect(readState({ kind: "starting", launch, slot: 1, claimedAt: 0 })).toEqual({ kind: "idle", column: "inProgress", last: null, botRun: null, cursorRun: null });
	expect(columnOf(readState({ kind: "stopping", launch, slot: 2, agent, requestedAt: 0 }))).toBe("inProgress");
	const run = { kind: "ended", launchId: "l", endedAt: 1, agent, outcome: "finished", prUrl: "https://github.com/a/b/pull/1" };
	expect(readState({ kind: "review", run })).toEqual({ kind: "idle", column: "inReview", last: run, botRun: null, cursorRun: null });
	expect(readState({ kind: "idle", column: "done", last: { kind: "launchLost", launchId: "l", endedAt: 1 } })).toEqual({ kind: "idle", column: "done", last: null, botRun: null, cursorRun: null });
	expect(() => readState({ kind: "mystery" })).toThrow();
});

test("a stored Bot run reads back, one stored before pass_run reads as not passed on, and a malformed one is dropped", () => {
	const botRun = { bot: "ops", status: "working", requestedAt: 1, startedAt: 2, passedOn: { by: "kanban", at: 1 } };
	expect(readState({ kind: "idle", column: "inProgress", last: null, botRun }).botRun).toEqual(botRun);
	const before = { bot: "ops", status: "requested", requestedAt: 1, startedAt: null };
	expect(readState({ kind: "idle", column: "inProgress", last: null, botRun: before }).botRun).toEqual({ ...before, passedOn: null });
	expect(readState({ kind: "idle", column: "todo", last: null, botRun: { bot: "ops" } }).botRun).toBeNull();
});

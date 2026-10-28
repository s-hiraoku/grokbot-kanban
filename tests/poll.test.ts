import { expect, test } from "vitest";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, pollWait } from "@/lib/poll";

test("a hidden tab does not sync, and a visible tab waits long enough for Neon to suspend", () => {
	expect(pollWait(false, false)).toBeNull();
	expect(pollWait(false, true)).toBeNull();
	expect(pollWait(true, false)).toBe(IDLE_POLL_MS);
	expect(IDLE_POLL_MS).toBeGreaterThan(5 * 60 * 1000);
});

test("a visible Cursor run syncs within a minute", () => {
	expect(pollWait(true, true)).toBe(ACTIVE_POLL_MS);
	expect(ACTIVE_POLL_MS).toBe(60_000);
});

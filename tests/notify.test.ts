import { expect, test } from "vitest";
import { TOAST_LIMIT, TOAST_MS, commandToast, pushToast } from "@/lib/notify";

test("a successful command toasts only when the server has something to say", () => {
	expect(commandToast(200, { notice: null })).toBeNull();
	expect(commandToast(200, { notice: "   " })).toBeNull();
	expect(commandToast(200, { notice: "Card deleted" })).toEqual({ text: "Card deleted", tone: "success" });
	expect(commandToast(200, { notice: "Parked in Todo. Set a repo to run it.", tone: "warning" })).toEqual({
		text: "Parked in Todo. Set a repo to run it.",
		tone: "warning",
	});
	// An unknown tone from the server is never shown louder than it should be.
	expect(commandToast(200, { notice: "Done", tone: "shout" })?.tone).toBe("success");
});

test("every failed command shows a red toast, with a reason even when the server sent none", () => {
	expect(commandToast(400, { notice: "Stop the agent before deleting this card." })).toEqual({ text: "Stop the agent before deleting this card.", tone: "error" });
	for (const status of [400, 403, 404, 500, 503]) {
		const toast = commandToast(status, {});
		expect(toast?.tone).toBe("error");
		expect(toast?.text.length).toBeGreaterThan(10);
	}
	expect(commandToast(403, {})?.text).toMatch(/another site/);
	expect(commandToast(500, {})?.text).toContain("500");
});

test("problems stay up longer than good news", () => {
	expect(TOAST_MS.error).toBeGreaterThan(TOAST_MS.warning);
	expect(TOAST_MS.warning).toBeGreaterThan(TOAST_MS.info);
	expect(TOAST_MS.info).toBeGreaterThan(TOAST_MS.success);
});

test("the stack drops repeats and keeps only the newest few", () => {
	let stack: { id: number; text: string; tone: "warning" | "success" }[] = [];
	stack = pushToast(stack, { id: 1, text: "Stop the agent first.", tone: "warning" });
	stack = pushToast(stack, { id: 2, text: "Stop the agent first.", tone: "warning" });
	expect(stack.map((toast) => toast.id)).toEqual([2]);
	for (let id = 3; id < 3 + TOAST_LIMIT + 1; id++) stack = pushToast(stack, { id, text: `t${id}`, tone: "success" });
	expect(stack).toHaveLength(TOAST_LIMIT);
	expect(stack.at(-1)?.id).toBe(3 + TOAST_LIMIT);
});

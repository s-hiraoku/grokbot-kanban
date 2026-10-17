import { expect, test } from "vitest";
import { TOAST_MS, commandToast } from "@/lib/notify";

test("a successful command toasts only when the server has something to say", () => {
	expect(commandToast(200, { notice: null })).toBeNull();
	expect(commandToast(200, { notice: "   " })).toBeNull();
	expect(commandToast(200, { notice: "Card deleted" })).toEqual({ text: "Card deleted", tone: "success" });
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

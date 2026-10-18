import { expect, test } from "vitest";
import { exactTime, shortDate } from "@/components/CreatedAt";

test("a card older than two days shows its date, with the year only when it is not this year", () => {
	const now = new Date(2026, 9, 18, 9, 0);
	expect(shortDate(new Date(2026, 9, 12, 14, 3).toISOString(), now)).toBe("10/12");
	expect(shortDate(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe("2025/12/31");
});

test("hovering shows the exact time in the viewer's time zone", () => {
	expect(exactTime(new Date(2026, 9, 12, 14, 3).toISOString())).toBe("2026/10/12 14:03");
});

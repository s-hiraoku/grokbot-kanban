import { expect, test } from "@playwright/test";
import { cardTitled, drawer, openCard, signIn, tool, unique } from "./helpers";

test("a wrong password is refused with a message, and the right one opens the board", async ({ page, request }) => {
	await tool(request, "create_card", { bot: "Scout", title: `login ${unique()}` });
	await page.goto("/login");
	await expect(page.getByLabel("Password")).toBeFocused();
	await page.getByLabel("Password").fill("not the password");
	await page.getByRole("button", { name: /Sign in/ }).click();
	await expect(page.locator("form").getByRole("alert")).toContainText("did not match");
	await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
	await signIn(page);
	await expect(page.getByRole("button", { name: /New card/ })).toBeVisible();
});

test("/ jumps to search, which filters the cards, and Escape clears it", async ({ page, request }) => {
	const needle = `needle ${unique()}`;
	const other = `other ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title: needle });
	await tool(request, "create_card", { bot: "Scout", title: other });
	await signIn(page);

	await page.keyboard.press("/");
	const search = page.getByRole("searchbox", { name: /Search cards/ });
	await expect(search).toBeFocused();
	await page.keyboard.type(needle);
	await expect(cardTitled(page, needle)).toBeVisible();
	await expect(cardTitled(page, other)).toHaveCount(0);
	const filters = page.getByRole("status", { name: "Filters" });
	await expect(filters).toContainText(`Search${needle}`);
	await page.keyboard.press("Escape");
	await expect(search).toHaveValue("");
	await expect(cardTitled(page, other)).toBeVisible();
	await expect(filters).toHaveCount(0);

	// Each filter has its own ×; with two, Clear all removes both.
	await search.fill(needle);
	await page.getByRole("button", { name: /^Scout,/ }).click();
	await expect(filters).toContainText("MemberScout");
	await filters.getByRole("button", { name: "Remove the member filter" }).click();
	await expect(filters).not.toContainText("Member");
	await page.getByRole("button", { name: /^Scout,/ }).click();
	await filters.getByRole("button", { name: "Clear all" }).click();
	await expect(filters).toHaveCount(0);
	await expect(search).toHaveValue("");

	await search.fill(needle);
	await page.getByRole("button", { name: "Clear search" }).click();
	await expect(search).toHaveValue("");
	await expect(search).toBeFocused();
});

for (const [name, width, height] of [
	["phone", 390, 760],
	["laptop", 1280, 720],
] as const) {
	test(`on a ${name} the board fits the window without sideways page scrolling`, async ({ page, request }) => {
		await tool(request, "create_card", { bot: "Scout", title: `fit ${unique()}`, body: "とても長い本文です。".repeat(30) });
		await page.setViewportSize({ width, height });
		await signIn(page);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(0);
		await expect(page.getByRole("button", { name: /New card/ })).toBeInViewport();
	});
}

test("a card shows how long ago it was filed, then its date after two days, with the exact time on hover", async ({ page, request }) => {
	const title = `dated ${unique()}`;
	await tool(request, "create_card", { bot: "Ops", title });
	await signIn(page);
	const filed = cardTitled(page, title).locator("footer time");
	await expect(filed).toHaveText("just now");
	const iso = (await filed.getAttribute("datetime"))!;
	const local = await page.evaluate((value) => {
		const date = new Date(value);
		const pad = (n: number) => String(n).padStart(2, "0");
		return { day: `${date.getMonth() + 1}/${date.getDate()}`, exact: `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` };
	}, iso);
	await expect(filed).toHaveAttribute("title", local.exact);

	// Three days on, the same card reads as its date, on the board and in the drawer.
	await page.clock.install({ time: Date.parse(iso) + 3 * 24 * 60 * 60 * 1000 });
	await page.reload();
	await expect(filed).toHaveText(local.day);
	await openCard(page, title);
	await expect(drawer(page).getByText(`Filed by Ops, ${local.day}`)).toBeVisible();
});

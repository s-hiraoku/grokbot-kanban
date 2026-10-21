import { expect, test } from "@playwright/test";
import { cardTitled, drawer, nextGitHubSignIn, openCard, signIn, tool, unique } from "./helpers";

test("sign-in goes through GitHub, turns away other accounts, and sign-out ends the session", async ({ page, request }) => {
	const title = `login ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title });
	const signInLink = page.getByRole("link", { name: "Sign in with GitHub" });

	await page.goto("/");
	await expect(page).toHaveURL(/\/login$/);
	await nextGitHubSignIn(page, { login: "someone-else", id: 7 });
	await signInLink.click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText("This board belongs to another GitHub account.");
	await expect(page.getByText(title)).toHaveCount(0);

	await nextGitHubSignIn(page, { deny: true });
	await signInLink.click();
	await expect(page.getByRole("main").getByRole("alert")).toHaveText("GitHub sign-in was cancelled.");

	await nextGitHubSignIn(page);
	await signIn(page);
	await expect(cardTitled(page, title)).toBeVisible();
	// Signed in, /login goes straight to the board.
	await page.goto("/login");
	await expect(page.getByRole("button", { name: /New card/ })).toBeVisible();

	const session = (await page.context().cookies()).find((cookie) => cookie.name === "kanban_session");
	expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(signInLink).toBeVisible();
	// The old cookie was ended on the server, so putting it back does not reopen the board.
	await page.context().addCookies([session!]);
	await page.goto("/");
	await expect(page).toHaveURL(/\/login$/);
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

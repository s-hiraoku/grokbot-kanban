import { expect, test } from "@playwright/test";
import { cardTitled, openMenu, columnOf, expectFullyVisible, signIn, tool, unique } from "./helpers";

test("Run on a card with a Bot assignee starts the run at once, with no menu", async ({ page, request }) => {
	const title = `assigned ${unique()}`;
	await tool(request, "create_card", { bot: "Ops", title, assignees: ["Ops"] });
	await signIn(page);

	await cardTitled(page, title).getByRole("button", { name: "Run" }).click();
	await expect(openMenu(page)).toHaveCount(0);
	await expect(cardTitled(page, title).locator(".pill-text")).toHaveText("Run requested");
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", /In Progress/);
	const queue = await tool(request, "list_run_requests", { bot: "Ops" });
	expect(queue.cards.map((card: { title: string }) => card.title)).toContain(title);
});

test("Run on a card with no Bot assignee asks which Bot, drawn above the cards below it", async ({ page, request }) => {
	const title = `nobody ${unique()}`;
	// A low-priority card is drawn faded, which once trapped its menu under the next card.
	await tool(request, "create_card", { bot: "Scout", title, priority: "low" });
	// Cards filed after it sit right under it in Inbox.
	for (let index = 0; index < 3; index += 1) await tool(request, "create_card", { bot: "Scout", title: `below ${unique()}` });
	await signIn(page);

	await cardTitled(page, title).getByRole("button", { name: "Run" }).click();
	await expectFullyVisible(openMenu(page));
	await page.getByRole("menuitem", { name: "Scout" }).click();
	await expect(cardTitled(page, title).locator(".pill-text")).toHaveText("Run requested");
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", /In Progress/);
});

test("menus on a card at the bottom of the screen open where every item can be picked", async ({ page, request }) => {
	for (let index = 0; index < 8; index += 1) await tool(request, "create_card", { bot: "Scout", title: `filler ${unique()}`, body: "two\nlines" });
	const title = `bottom ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title });
	await page.setViewportSize({ width: 1280, height: 640 });
	await signIn(page);
	const card = cardTitled(page, title);
	await card.scrollIntoViewIfNeeded();

	await card.getByRole("button", { name: "Run" }).click();
	await expectFullyVisible(openMenu(page));
	await page.getByRole("menuitem").last().hover();
	await page.keyboard.press("Escape");

	await card.getByRole("button", { name: "Card actions" }).click();
	await expectFullyVisible(openMenu(page));
	await page.keyboard.press("Escape");
	await expect(openMenu(page)).toHaveCount(0);
});

test("a running card's badge cancels the run", async ({ page, request }) => {
	const title = `cancel ${unique()}`;
	await tool(request, "create_card", { bot: "Ops", title, assignees: ["Ops"] });
	await signIn(page);
	await cardTitled(page, title).getByRole("button", { name: "Run" }).click();
	await cardTitled(page, title).getByRole("button", { name: /Waiting for Ops/ }).click();
	await expectFullyVisible(openMenu(page));
	await page.getByRole("menuitem", { name: "Cancel run" }).click();
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", "Todo");
	await expect(cardTitled(page, title).getByRole("button", { name: "Run" })).toBeVisible();
});

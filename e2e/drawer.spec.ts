import { expect, test } from "@playwright/test";
import { cardTitled, expectFullyVisible, signIn, tool, unique } from "./helpers";

test("a click reads the card in the drawer; New card and Edit open the dialog", async ({ page, request }) => {
	const title = `open me ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "details" });
	await signIn(page);
	const card = cardTitled(page, title);

	await card.locator(".title").click();
	await expect(page.locator(".drawer")).toBeVisible();
	await expect(page.locator(".drawer.wide")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.locator(".drawer")).toHaveCount(0);

	await card.getByRole("button", { name: "Card actions" }).click();
	await page.getByRole("menuitem", { name: "Edit" }).click();
	await expect(page.locator(".drawer.wide")).toBeVisible();
	await expect(page.locator(".drawer .body-input")).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: /New card/ }).click();
	await expect(page.locator(".drawer.wide")).toBeVisible();
	await page.keyboard.press("Escape");

	// The large view from Edit is not remembered for the next click.
	await card.locator(".title").click();
	await expect(page.locator(".drawer")).toBeVisible();
	await expect(page.locator(".drawer.wide")).toHaveCount(0);
});

test("every drawer menu opens in full, and Escape closes the menu before the drawer", async ({ page, request }) => {
	const title = `menus ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "line\n".repeat(40) });
	for (const bot of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"]) await tool(request, "update_my_profile", { bot, role: "x" });
	await page.setViewportSize({ width: 1280, height: 720 });
	await signIn(page);
	await cardTitled(page, title).locator(".title").click();
	const drawer = page.locator(".drawer");

	await drawer.getByRole("button", { name: /^Status:/ }).click();
	await expectFullyVisible(page.getByRole("menu"));
	await page.keyboard.press("Escape");
	await expect(drawer).toBeVisible();

	await drawer.getByRole("button", { name: "More actions" }).click();
	await expectFullyVisible(page.getByRole("menu"));
	await page.keyboard.press("Escape");

	await drawer.getByRole("button", { name: "Run with a Grok Bot" }).click();
	await expectFullyVisible(page.getByRole("menu"));
	await page.keyboard.press("Escape");

	// Assignees sit low in the drawer, under a long body.
	const edit = drawer.locator(".assignees-edit");
	await edit.scrollIntoViewIfNeeded();
	await edit.click();
	const picker = page.locator(".assignees-menu");
	await expectFullyVisible(picker);
	const search = picker.getByRole("searchbox", { name: "Filter members" });
	await expect(search).toBeFocused();
	const [pickerBox, searchBox] = await Promise.all([picker.boundingBox(), search.boundingBox()]);
	expect(searchBox!.width).toBeGreaterThan(pickerBox!.width - 24);
	await search.fill("ech");
	await page.keyboard.press("Enter");
	await expect(drawer.locator(".assignees-list")).toContainText("Echo");
	await page.keyboard.press("Escape");
	await expect(picker).toHaveCount(0);
	await expect(drawer).toBeVisible();
});

test("on a phone the drawer menus and the assignee list fit the screen", async ({ page, request }) => {
	const title = `phone ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "line\n".repeat(20) });
	await page.setViewportSize({ width: 390, height: 760 });
	await signIn(page);
	await cardTitled(page, title).locator(".title").click();
	const drawer = page.locator(".drawer");

	await drawer.getByRole("button", { name: /^Status:/ }).click();
	await expectFullyVisible(page.getByRole("menu"));
	await page.keyboard.press("Escape");

	const edit = drawer.locator(".assignees-edit");
	await edit.scrollIntoViewIfNeeded();
	await edit.click();
	await expectFullyVisible(page.locator(".assignees-menu"));
});

import { expect, test } from "@playwright/test";
import { cardTitled, drawer, expectFullyVisible, openCard, openMenu, runPicker, signIn, tool, unique } from "./helpers";

test("a click reads the card in the drawer; New card and Edit open the dialog", async ({ page, request }) => {
	const title = `open me ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "details" });
	await signIn(page);
	const card = cardTitled(page, title);

	await openCard(page, title);
	await expect(drawer(page)).toHaveAttribute("data-wide", "false");
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toHaveCount(0);

	await card.getByRole("button", { name: "Card actions" }).click();
	await page.getByRole("menuitem", { name: "Edit" }).click();
	await expect(drawer(page)).toHaveAttribute("data-wide", "true");
	await expect(drawer(page).getByRole("textbox", { name: "Details" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toHaveCount(0);

	await page.getByRole("button", { name: /New card/ }).click();
	await expect(drawer(page)).toHaveAttribute("data-wide", "true");
	await expect(drawer(page).getByRole("textbox").first()).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toHaveCount(0);

	// The large view from Edit is not remembered for the next click.
	await openCard(page, title);
	await expect(drawer(page)).toHaveAttribute("data-wide", "false");
});

test("every drawer menu opens in full, and Escape closes the menu before the drawer", async ({ page, request }) => {
	const title = `menus ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "line\n".repeat(40) });
	for (const bot of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"]) await tool(request, "update_my_profile", { bot, role: "x" });
	await page.setViewportSize({ width: 1280, height: 720 });
	await signIn(page);
	await openCard(page, title);
	const panel = drawer(page);

	await panel.getByRole("button", { name: /^Status:/ }).click();
	await expectFullyVisible(openMenu(page));
	await page.keyboard.press("Escape");
	await expect(openMenu(page)).toHaveCount(0);
	await expect(panel).toBeVisible();

	await panel.getByRole("button", { name: "Run with a Grok Bot" }).click();
	await expectFullyVisible(runPicker(page));
	await page.keyboard.press("Escape");
	await expect(panel).toBeVisible();

	// Assignees sit low in the drawer, under a long body.
	const fields = panel.getByRole("complementary", { name: "Card fields" });
	const edit = fields.getByRole("button", { name: "Edit" });
	await edit.scrollIntoViewIfNeeded();
	await edit.click();
	const picker = page.locator('[data-slot="assignee-menu"]');
	await expectFullyVisible(picker);
	const search = picker.getByRole("combobox", { name: "Search members" });
	await expect(search).toBeFocused();
	await search.fill("ech");
	await page.keyboard.press("Enter");
	await expect(fields.locator('[data-slot="assignees"]')).toContainText("Echo");
	// The list stays open for another pick; Escape closes it and leaves the drawer.
	await expect(picker).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(picker).toHaveCount(0);
	await expect(panel).toBeVisible();
	await page.keyboard.press("Escape");
	// The pick is unsaved, so the drawer asks before dropping it.
	await expect(page.getByRole("alertdialog", { name: "Discard your changes?" })).toBeVisible();
});

test("on a phone the drawer menus and the assignee list fit the screen", async ({ page, request }) => {
	const title = `phone ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "line\n".repeat(20) });
	await page.setViewportSize({ width: 390, height: 760 });
	await signIn(page);
	await openCard(page, title);
	const panel = drawer(page);
	await expectFullyVisible(panel.getByRole("button", { name: "Close" }).first());
	await expectFullyVisible(panel.getByRole("button", { name: "Copy link" }));
	await expectFullyVisible(panel.getByRole("button", { name: "Delete card" }));

	await panel.getByRole("button", { name: /^Status:/ }).click();
	await expectFullyVisible(openMenu(page));
	await page.keyboard.press("Escape");

	const edit = panel.getByRole("complementary", { name: "Card fields" }).getByRole("button", { name: "Edit" });
	await edit.scrollIntoViewIfNeeded();
	await edit.click();
	await expectFullyVisible(page.locator('[data-slot="assignee-menu"]'));
});

test("closing with unsaved changes asks first, and Keep editing keeps them", async ({ page, request }) => {
	const title = `dirty ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title });
	await signIn(page);
	await openCard(page, title);
	const panel = drawer(page);
	const titleBox = panel.getByRole("textbox").first();
	await titleBox.fill(`${title} edited`);

	await page.keyboard.press("Escape");
	const confirm = page.getByRole("alertdialog", { name: "Discard your changes?" });
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Cancel" }).click();
	await expect(confirm).toHaveCount(0);
	await expect(titleBox).toHaveValue(`${title} edited`);

	await panel.getByRole("button", { name: "Close" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
	await expect(drawer(page)).toHaveCount(0);
	await expect(cardTitled(page, title)).toHaveCount(1);
	await expect(cardTitled(page, `${title} edited`)).toHaveCount(0);

	// A drawer with nothing changed closes at once.
	await openCard(page, title);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(drawer(page)).toHaveCount(0);
});

test("a new card with nothing typed closes at once; with a title it asks first", async ({ page, request }) => {
	await tool(request, "create_card", { bot: "Scout", title: `seed ${unique()}` });
	await signIn(page);
	await page.keyboard.press("n");
	await expect(drawer(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toHaveCount(0);

	// Right away, while the last one is still animating out.
	await page.keyboard.press("n");
	await page.waitForTimeout(400);
	// The leaving drawer does not take focus back from the new one.
	await expect(drawer(page).getByRole("textbox").first()).toBeFocused();
	await page.keyboard.type("half a thought");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("alertdialog", { name: "Discard this new card?" })).toBeVisible();
});

test("the drawer header's copy button copies a link to the card", async ({ page, context, request }) => {
	const title = `copy ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title });
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await signIn(page);
	await openCard(page, title);
	await drawer(page).getByRole("button", { name: "Copy link" }).click();
	await expect(page.getByText("Link copied")).toBeVisible();
	const link = await page.evaluate(() => navigator.clipboard.readText());
	const id = /\/\?card=([0-9a-f-]{36})$/.exec(link)?.[1];
	expect(id).toBeTruthy();
	await expect(page.locator(`[data-card-id="${id}"]`)).toContainText(title);
});

test("Delete asks before removing the card, from the board and from the drawer", async ({ page, request }) => {
	const first = `delete one ${unique()}`;
	const second = `delete two ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title: first });
	await tool(request, "create_card", { bot: "Scout", title: second });
	await signIn(page);

	await cardTitled(page, first).getByRole("button", { name: "Card actions" }).click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	const confirm = page.getByRole("alertdialog", { name: /Delete/ });
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Cancel" }).click();
	await expect(cardTitled(page, first)).toHaveCount(1);

	await cardTitled(page, first).getByRole("button", { name: "Card actions" }).click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: /^Delete/ }).click();
	await expect(cardTitled(page, first)).toHaveCount(0);

	await openCard(page, second);
	await drawer(page).getByRole("button", { name: "Delete card" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: /^Delete/ }).click();
	await expect(drawer(page)).toHaveCount(0);
	await expect(cardTitled(page, second)).toHaveCount(0);
});

test("the drawer, the dialog, and menus animate out before they are removed", async ({ page, request }) => {
	const title = `exit ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title });
	await signIn(page);
	const card = cardTitled(page, title);
	const closing = page.locator('[data-slot="card-drawer"][data-state="closed"]');

	await openCard(page, title);
	await expect(drawer(page)).toBeVisible();
	await page.keyboard.press("Escape");
	// Still on screen, animating out, and not catching clicks meant for the board.
	await expect(closing).toHaveCount(1);
	await expect(closing).toHaveCSS("pointer-events", "none");
	await expect(page.locator('[data-slot="card-drawer"]')).toHaveCount(0);

	await page.getByRole("button", { name: /New card/ }).click();
	await drawer(page).getByRole("button", { name: "Close" }).click();
	await expect(page.locator('[data-slot="card-drawer"][data-state="closed"][data-wide="true"]')).toHaveCount(1);
	await expect(page.locator('[data-slot="card-drawer"]')).toHaveCount(0);

	// Opening the card again while the last drawer is still leaving keeps the new one open.
	await openCard(page, title);
	await page.keyboard.press("Escape");
	await openCard(page, title);
	await page.waitForTimeout(400);
	await expect(drawer(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer(page)).toHaveCount(0);

	await card.getByRole("button", { name: "Card actions" }).click();
	await expect(openMenu(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator('[role="menu"][data-state="closed"]')).toHaveCount(1);
	await expect(page.locator('[role="menu"]')).toHaveCount(0);
});

test("the Bots panel keeps its close button in reach while the roster scrolls", async ({ page, request }) => {
	for (const bot of ["Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar"]) await tool(request, "update_my_profile", { bot, role: "x" });
	await tool(request, "create_card", { bot: "Scout", title: `bots ${unique()}` });
	await page.setViewportSize({ width: 390, height: 760 });
	await signIn(page);
	await page.getByRole("button", { name: /Bots & MCP/ }).click();
	const panel = page.getByRole("dialog", { name: "Bots & MCP" });
	await expect(panel).toBeVisible();
	await panel.evaluate((element) => element.scrollTo(0, element.scrollHeight));
	const close = panel.getByRole("button", { name: "Close" });
	await expectFullyVisible(close);
	await close.click();
	await expect(panel).toHaveCount(0);
});

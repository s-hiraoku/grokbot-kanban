// Journey: the owner moves cards by every entry point (drawer status menu, mouse drag, keyboard drag) and assigns one
// by dropping it on a dock face; each move is checked on screen and in storage over MCP.
// Run: node .cursor/skills/verify-kanban/journeys/move-card.mjs [desktop|laptop]
import { column, columnOf, drawer, dragCard, expect, journey, openCard, openMenu, tool, unique } from "../scripts/kanban.mjs";

const viewport = process.argv[2] ?? "desktop";
const a = `verify move a ${unique()}`;
const b = `verify move b ${unique()}`;
// Seeded the way a Bot files cards; "Scout" joins the roster and gets a dock face.
const cardA = (await tool("create_card", { bot: "Scout", title: a })).card;
const cardB = (await tool("create_card", { bot: "Scout", title: b })).card;
const stored = async (id) => tool("get_card", { card: id });

await journey(`move-card-${viewport}`, { viewport }, async (s) => {
	const { page } = s;
	await s.shot("board-before");
	await s.step("drawer status menu moves A from Inbox to Todo", async () => {
		await openCard(page, a);
		await drawer(page).getByRole("button", { name: /^Status:/ }).click();
		await openMenu(page).getByRole("menuitem", { name: "Todo" }).click();
		await expect(columnOf(page, a)).toHaveAttribute("aria-label", "Todo");
		expect((await stored(cardA.id)).column).toBe("todo");
		// Escape closes the front-most thing first; wait for the menu to be gone so this one closes the drawer.
		await expect(page.locator('[role="menu"]')).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(page.locator('[data-slot="card-drawer"]')).toHaveCount(0);
	});
	await s.step("mouse drag moves A from Todo to In Review", async () => {
		await dragCard(page, a, column(page, "In Review"));
		await expect(columnOf(page, a)).toHaveAttribute("aria-label", "In Review");
		expect((await stored(cardA.id)).column).toBe("inReview");
	});
	await s.shot("after-drag");
	await s.step("keyboard drag (Space, ArrowRight, Space) moves B from Inbox to Todo", async () => {
		await page.locator(`[data-card-id="${cardB.id}"]`).focus();
		await page.keyboard.press("Space");
		await page.waitForTimeout(250);
		await page.keyboard.press("ArrowRight");
		await page.waitForTimeout(250);
		await page.keyboard.press("Space");
		await expect(columnOf(page, b)).toHaveAttribute("aria-label", "Todo");
		expect((await stored(cardB.id)).column).toBe("todo");
	});
	await s.step("dropping A on Scout's dock face assigns Scout and leaves A in its column", async () => {
		await dragCard(page, a, page.getByRole("button", { name: /^Scout,/ }));
		await expect(page.locator(`[data-card-id="${cardA.id}"]`).getByLabel(/Assigned to Scout/)).toBeVisible();
		const card = await stored(cardA.id);
		expect(card.assignees.map((member) => member.name ?? member)).toContain("Scout");
		expect(card.column).toBe("inReview");
		s.save("mcp-card-a", card);
	});
	await s.step("after a reload both cards are where they were left", async () => {
		await page.reload();
		await expect(columnOf(page, a)).toHaveAttribute("aria-label", "In Review");
		await expect(columnOf(page, b)).toHaveAttribute("aria-label", "Todo");
	});
	await s.shot("board-after");
});

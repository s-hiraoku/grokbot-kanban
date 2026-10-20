// Journey: the owner files a card with New card, and it lands in Inbox, is stored, and survives a reload.
// Run: node .cursor/skills/verify-kanban/journeys/create-card.mjs [desktop|laptop|phone]
import { cardTitled, column, drawer, expect, journey, openCard, tool, unique } from "../scripts/kanban.mjs";

const viewport = process.argv[2] ?? "desktop";
const title = `verify card ${unique()}`;
const details = "ログが6秒で途切れる\n- steps to reproduce";

await journey(`create-card-${viewport}`, { viewport }, async (s) => {
	const { page } = s;
	// The board needs no seed: an empty board is a valid start.
	await s.shot("board-before");
	await s.step("New card opens the large dialog with the title field focused", async () => {
		await page.getByRole("button", { name: /New card/ }).click();
		await expect(drawer(page)).toHaveAttribute("data-wide", "true");
		await expect(drawer(page).getByPlaceholder("What needs doing?")).toBeFocused();
	});
	await s.step("type a title and details", async () => {
		await page.keyboard.type(title);
		await drawer(page).getByRole("textbox", { name: "Details" }).fill(details);
	});
	await s.shot("dialog-filled");
	await s.step("Add to Inbox closes the dialog and shows the card in Inbox", async () => {
		await drawer(page).getByRole("button", { name: "Add to Inbox" }).click();
		await expect(drawer(page)).toHaveCount(0);
		await expect(column(page, "Inbox").locator("[data-card-id]", { hasText: title })).toHaveCount(1);
	});
	await s.shot("board-after");
	const stored = await s.step("the card is stored: an MCP read (no bot name, so the roster stays as it was) sees it in inbox with the details", async () => {
		const { cards } = await tool("list_cards", { query: title });
		expect(cards).toHaveLength(1);
		const card = await tool("get_card", { card: cards[0].id });
		expect(card.card ?? card).toMatchObject({ title, column: "inbox" });
		expect(JSON.stringify(card)).toContain("ログが6秒で途切れる");
		return card;
	});
	s.save("mcp-get_card", stored);
	await s.step("after a reload the card is still in Inbox and its drawer shows the details", async () => {
		await page.reload();
		await expect(column(page, "Inbox").locator("[data-card-id]", { hasText: title })).toHaveCount(1);
		await openCard(page, title);
		await expect(drawer(page)).toContainText("ログが6秒で途切れる");
	});
	await s.shot("drawer-after-reload");
	await expect(cardTitled(page, title)).toHaveCount(1);
});

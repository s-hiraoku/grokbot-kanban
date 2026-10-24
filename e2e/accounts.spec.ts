import { expect, test, type APIRequestContext } from "@playwright/test";
import { cardTitled, nextGitHubSignIn, signIn, tool, unique } from "./helpers";

async function summary(request: APIRequestContext, token: string) {
	return request.post("/api/mcp", {
		headers: { Authorization: `Bearer ${token}` },
		data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "board_summary", arguments: { bot: "Kanban" } } },
	});
}

test("a connector token is made on the board, shown once, opens the board, and stops working once revoked", async ({ page, request }) => {
	await tool(request, "create_card", { bot: "Scout", title: `tokens ${unique()}` });
	await signIn(page);
	await page.getByRole("button", { name: /Bots & MCP/ }).click();
	const panel = page.getByRole("dialog", { name: "Bots & MCP" });
	await panel.getByRole("tab", { name: "Connect Grok Bot" }).click();

	const name = `Kanban ${unique()}`;
	await panel.getByLabel("Token name").fill(name);
	await panel.getByRole("button", { name: "Make a token" }).click();
	const shown = panel.getByRole("status", { name: "New token" });
	await expect(shown).toContainText(`Copy the token for “${name}” now`);
	const token = (await shown.locator('[data-slot="new-token"]').textContent())!;
	expect(token).toMatch(/^gbk_/);
	const row = panel.getByRole("list", { name: "Tokens" }).getByRole("listitem").filter({ hasText: name });
	await expect(row).toContainText("Not used yet");

	expect((await summary(request, token)).status()).toBe(200);
	// Shown once: after Done, and after reopening the panel, only the name is left.
	await shown.getByRole("button", { name: "Done" }).click();
	await expect(panel.getByText(token)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: /Bots & MCP/ }).click();
	await panel.getByRole("tab", { name: "Connect Grok Bot" }).click();
	await expect(row).toContainText("Last used just now");
	await expect(panel.getByText(token)).toHaveCount(0);

	await row.getByRole("button", { name: "Revoke" }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toContainText(`Revoke “${name}”?`);
	await confirm.getByRole("button", { name: "Revoke token" }).click();
	await expect(row).toHaveCount(0);
	expect((await summary(request, token)).status()).toBe(401);
});

test("another allowed account gets an empty board of its own, and its Bots never see the owner's cards", async ({ page, browser, request }) => {
	const ownerTitle = `owner only ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title: ownerTitle });

	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const alice = await context.newPage();
	await nextGitHubSignIn(alice, { login: "alice", id: 1001 });
	await alice.goto("/login");
	await alice.getByRole("link", { name: "Sign in with GitHub" }).click();
	await expect(alice.getByRole("button", { name: /New card/ })).toBeVisible();
	await expect(alice.getByText(ownerTitle)).toHaveCount(0);

	await alice.getByRole("button", { name: /Bots & MCP/ }).click();
	const panel = alice.getByRole("dialog", { name: "Bots & MCP" });
	await panel.getByRole("tab", { name: "Connect Grok Bot" }).click();
	await panel.getByRole("button", { name: "Make a token" }).click();
	const token = (await panel.locator('[data-slot="new-token"]').textContent())!;
	const aliceTitle = `alice only ${unique()}`;
	const filed = await request.post("/api/mcp", {
		headers: { Authorization: `Bearer ${token}` },
		data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_card", arguments: { bot: "Scout", title: aliceTitle } } },
	});
	expect(filed.status()).toBe(200);
	const listed = await request.post("/api/mcp", {
		headers: { Authorization: `Bearer ${token}` },
		data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_cards", arguments: { bot: "Scout", query: "only" } } },
	});
	const titles = ((await listed.json()).result.structuredContent.cards as { title: string }[]).map((card) => card.title);
	expect(titles).toEqual([aliceTitle]);
	await context.close();

	await signIn(page);
	await expect(cardTitled(page, ownerTitle)).toBeVisible();
	await expect(page.getByText(aliceTitle)).toHaveCount(0);
});

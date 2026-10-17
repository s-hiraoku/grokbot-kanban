import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const OWNER_PASSWORD = "e2e-owner-password-0123456789abcdefghij";
export const BOT_TOKEN = "e2e-bot-token-0123456789abcdefghijklmnopq";

/** Calls an MCP tool as a Grok Bot would. */
export async function tool(request: APIRequestContext, name: string, args: Record<string, unknown>) {
	const response = await request.post("/api/mcp", {
		headers: { Authorization: `Bearer ${BOT_TOKEN}` },
		data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
	});
	const body = await response.json();
	if (body.result?.isError) throw new Error(body.result.content[0].text);
	return body.result.structuredContent;
}

export async function signIn(page: Page) {
	await page.goto("/login");
	await page.fill("input[name=password]", OWNER_PASSWORD);
	await page.click("button[type=submit]");
	await page.waitForSelector(".card");
	// The board is server-rendered; wait for React to take over before clicking.
	await page.waitForFunction(() => {
		const card = document.querySelector(".card");
		return card !== null && Object.keys(card).some((key) => key.startsWith("__reactFiber"));
	});
}

export const unique = () => Math.random().toString(36).slice(2, 8);
export const cardTitled = (page: Page, title: string) => page.locator(".card", { hasText: title });
export const columnOf = (page: Page, title: string) => page.locator(".column", { has: cardTitled(page, title) });

/**
 * Checks that a floating element is fully inside the window and is what the pointer hits at every row, so
 * nothing is cut off or drawn over it.
 */
export async function expectFullyVisible(popup: Locator) {
	await expect(popup).toBeVisible();
	const problems = await popup.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const found: string[] = [];
		if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) {
			found.push(`outside the window: ${JSON.stringify(box)}`);
		}
		for (let y = Math.max(box.top, 0) + 2; y < Math.min(box.bottom, window.innerHeight) - 1; y += 6) {
			const hit = document.elementFromPoint(box.left + box.width / 2, y);
			if (!hit || !element.contains(hit)) found.push(`${Math.round(y)}px is covered by ${hit?.className || hit?.tagName || "nothing"}`);
		}
		let opacity = 1;
		for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
		if (opacity < 1) found.push(`faded to ${opacity}`);
		return found;
	});
	expect(problems).toEqual([]);
}

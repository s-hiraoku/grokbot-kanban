import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
	await page.getByRole("link", { name: "Sign in with GitHub" }).click();
	await page.waitForSelector("[data-card-id]");
	// The board is server-rendered; wait for React to take over before clicking.
	await page.waitForFunction(() => {
		const card = document.querySelector("[data-card-id]");
		return card !== null && Object.keys(card).some((key) => key.startsWith("__reactFiber"));
	});
	// Effects such as the keyboard shortcuts attach once the page has finished loading its code.
	await page.waitForLoadState("networkidle");
}

export const unique = () => Math.random().toString(36).slice(2, 8);
export const cardTitled = (page: Page, title: string) => page.locator("[data-card-id]", { hasText: title });
export const columnOf = (page: Page, title: string) => page.locator("section[data-column]", { has: cardTitled(page, title) });
/** Opens a card in the side drawer by clicking its title. */
export const openCard = (page: Page, title: string) => cardTitled(page, title).getByRole("heading", { name: title }).click();
/** The card drawer or dialog that is open now; one that just closed may still be animating out. */
export const drawer = (page: Page) => page.locator('[data-slot="card-drawer"][data-state="open"]');
export const runStatus = (page: Page, title: string) => cardTitled(page, title).locator('[data-slot="run-status"]');

/**
 * Checks that a floating element is fully inside the window and is what the pointer hits at every row, so
 * nothing is cut off or drawn over it.
 */
export async function expectFullyVisible(popup: Locator) {
	await expect(popup).toBeVisible();
	await settled(popup);
	const problems = await popup.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const found: string[] = [];
		if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) {
			found.push(`outside the window: ${JSON.stringify(box)}`);
		}
		for (let y = Math.max(box.top, 0) + 2; y < Math.min(box.bottom, window.innerHeight) - 1; y += 6) {
			const hit = document.elementFromPoint(box.left + box.width / 2, y);
			if (!hit || !element.contains(hit)) found.push(`${Math.round(y)}px is covered by ${hit?.getAttribute("class") || hit?.tagName || "nothing"}`);
		}
		let opacity = 1;
		for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
		if (opacity < 1) found.push(`faded to ${opacity}`);
		return found;
	});
	expect(problems).toEqual([]);
}

/** Waits for the element's and the page's running animations (a popup or drawer opening) to finish. */
export async function settled(locator: Locator) {
	await locator.evaluate(() => Promise.all(document.getAnimations().filter((item) => item.effect?.getComputedTiming().iterations !== Infinity).map((item) => item.finished.catch(() => undefined))));
}

/** The menu that is open now; one that just closed may still be fading out next to it. */
export const openMenu = (page: Page) => page.locator('[role="menu"][data-state="open"]');

/** Run's list of Bots and Cursor that is open now. */
export const runPicker = (page: Page) => page.locator('[data-slot="run-picker"][data-state="open"]');

/** Who the stand-in GitHub (e2e/fake-github.mjs) signs this page in as next; with nothing given, the owner. */
export async function nextGitHubSignIn(page: Page, as: { login?: string; id?: number; deny?: boolean } = {}) {
	await page.context().addCookies([{ name: "fake_github_as", value: encodeURIComponent(JSON.stringify(as)), domain: "localhost", path: "/" }]);
}

/** The stand-in Cursor API the tests run against (e2e/fake-cursor.mjs). */
export const FAKE_CURSOR = "http://localhost:3299";

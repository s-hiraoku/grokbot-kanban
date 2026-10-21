import { expect, test, type APIRequestContext } from "@playwright/test";
import { FAKE_CURSOR, cardTitled, columnOf, drawer, expectFullyVisible, openCard, openMenu, runPicker, runStatus, signIn, tool, unique } from "./helpers";

const REPO = { url: "https://github.com/s-hiraoku/shift-log", startingRef: "main" };

async function launches(request: APIRequestContext) {
	return (await (await request.get(`${FAKE_CURSOR}/__agents`)).json()) as { id: string; prompt: string; status: string }[];
}

test("Run's arrow hands a card to a Cursor agent, which lands in In Review with its pull request", async ({ page, request }) => {
	test.setTimeout(90_000);
	const title = `cursor ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, body: "Fix the redirect after sign-in.", repo: REPO, assignees: ["Scout"] });
	await signIn(page);
	const card = cardTitled(page, title);

	// With a Bot assigned, Run still goes straight to it; the arrow beside it offers Cursor.
	await card.getByRole("button", { name: /with another Bot or Cursor/ }).click();
	await expectFullyVisible(runPicker(page));
	await expect(runPicker(page).getByRole("option", { name: /Cursor agent/ })).toContainText("Opens a pull request on s-hiraoku/shift-log");
	await runPicker(page).getByRole("option", { name: /Cursor agent/ }).click();
	await expect(runStatus(page, title)).toHaveText("Cursor working");
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", "In Progress");
	await expect(page.getByText("Cursor is on it.")).toBeVisible();

	const agent = (await launches(request)).at(-1)!;
	expect(agent.prompt).toContain(`# ${title}`);

	await openCard(page, title);
	const panel = drawer(page);
	await expect(panel.getByRole("status")).toContainText("A Cursor agent is working on s-hiraoku/shift-log");
	await expect(panel.getByRole("link", { name: "Open in Cursor" })).toHaveAttribute("href", `https://cursor.com/agents/${agent.id}`);
	await page.keyboard.press("Escape");

	await request.post(`${FAKE_CURSOR}/__state`, { data: { agentId: agent.id, status: "FINISHED", prUrl: "https://github.com/s-hiraoku/shift-log/pull/42" } });
	// The board asks Cursor at most every 20 seconds; the next refresh after that lands the run.
	await page.waitForTimeout(21_000);
	await page.reload();
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", "In Review");
	await expect(card.getByRole("link", { name: "PR" })).toHaveAttribute("href", "https://github.com/s-hiraoku/shift-log/pull/42");
	await expect(runStatus(page, title)).toHaveCount(0);
});

test("Cursor needs the card's repo, and Cursor's refusal comes back as a message", async ({ page, request }) => {
	const bare = `no repo ${unique()}`;
	const blocked = `no access ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title: bare });
	await tool(request, "create_card", { bot: "Scout", title: blocked, repo: { url: "https://github.com/someone/no-access", startingRef: "main" } });
	await signIn(page);

	await cardTitled(page, bare).getByRole("button", { name: /Run with a Grok Bot or Cursor/ }).click();
	await expect(runPicker(page).getByRole("option", { name: /Cursor agent/ })).toBeDisabled();
	await expect(runPicker(page)).toContainText("Set the card's repo under More fields first.");
	await page.keyboard.press("Escape");

	const before = (await launches(request)).length;
	await cardTitled(page, blocked).getByRole("button", { name: /Run with a Grok Bot or Cursor/ }).click();
	await runPicker(page).getByRole("option", { name: /Cursor agent/ }).click();
	await expect(page.getByText("Repository not accessible (repo_access)")).toBeVisible();
	await expect(columnOf(page, blocked)).toHaveAttribute("aria-label", "Inbox");
	await expect(cardTitled(page, blocked).getByRole("button", { name: /Run with a Grok Bot or Cursor/ })).toBeVisible();
	expect((await launches(request)).length).toBe(before);
});

test("the Cursor badge cancels the agent and the card goes back to Todo", async ({ page, request }) => {
	const title = `cancel cursor ${unique()}`;
	await tool(request, "create_card", { bot: "Scout", title, repo: REPO });
	await signIn(page);
	await cardTitled(page, title).getByRole("button", { name: /Run with a Grok Bot or Cursor/ }).click();
	await runPicker(page).getByRole("option", { name: /Cursor agent/ }).click();
	await expect(runStatus(page, title)).toHaveText("Cursor working");

	await cardTitled(page, title).getByRole("button", { name: "A Cursor agent is working on this card" }).click();
	await expectFullyVisible(openMenu(page));
	await expect(page.getByRole("menuitem", { name: "Open in Cursor" })).toHaveAttribute("href", /https:\/\/cursor\.com\/agents\//);
	await page.getByRole("menuitem", { name: "Cancel run" }).click();
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", "Todo");
	await expect(runStatus(page, title)).toHaveCount(0);
	expect((await launches(request)).at(-1)!.status).toBe("CANCELLED");
});

test("a Grok Bot's hand-off to Cursor shows on the board with who sent it", async ({ page, request }) => {
	const title = `bot handoff ${unique()}`;
	const created = await tool(request, "create_card", { bot: "Scout", title, repo: REPO });
	const handed = await tool(request, "hand_off_to_cursor", { bot: "Scout", card: created.card.id, instructions: "Look at lib/auth.ts first." });
	expect(handed.message).toMatch(/Cursor is on it/);
	expect((await launches(request)).at(-1)!.prompt).toContain("## From Scout\nLook at lib/auth.ts first.");

	await signIn(page);
	await expect(runStatus(page, title)).toHaveText("Cursor working");
	await openCard(page, title);
	await expect(drawer(page).getByRole("status")).toContainText("by Scout");
	await expect(drawer(page).getByRole("complementary", { name: "Card fields" }).getByRole("link", { name: "Cursor agent" })).toBeVisible();
});

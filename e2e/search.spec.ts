import { expect, test, type APIRequestContext } from "@playwright/test";
import { FAKE_CURSOR, cardTitled, drawer, expectFullyVisible, openCard, runPicker, runStatus, signIn, tool, unique } from "./helpers";

const ROSTER: Record<string, string> = {
	Atlas: "地図とルートの調査",
	Beacon: "障害の通知",
	Cipher: "セキュリティレビュー",
	Dune: "データ集計",
	Ember: "インフラ運用",
	Fable: "リリースノート作成",
	Glint: "UI デザインレビュー",
	Harbor: "依存関係の更新",
	Iris: "ログ解析",
	Juniper: "ドキュメント整備",
};

async function fillRoster(request: APIRequestContext) {
	for (const [bot, role] of Object.entries(ROSTER)) await tool(request, "update_my_profile", { bot, role });
}

test("Run's list of Bots searches by name and role, and Enter runs the best match", async ({ page, request }) => {
	await fillRoster(request);
	const title = `search run ${unique()}`;
	await tool(request, "create_card", { bot: "Atlas", title });
	await signIn(page);

	await cardTitled(page, title).getByRole("button", { name: /Run with a Grok Bot/ }).click();
	const picker = runPicker(page);
	await expectFullyVisible(picker);
	const search = picker.getByRole("combobox", { name: "Search bots" });
	await expect(search).toBeFocused();
	// Each Bot shows its role, so two similar names can be told apart.
	await expect(picker.getByRole("option", { name: /Cipher/ })).toContainText("セキュリティレビュー");

	// A role finds the Bot; hiragana finds katakana; only the Bots that fit stay.
	await search.fill("れびゅー");
	await expect(picker.getByRole("option")).toHaveText([/Cipher/, /Glint/]);
	await search.fill("ui");
	await expect(picker.getByRole("option")).toHaveText([/Glint/]);
	await search.fill("gl");
	await expect(picker.getByRole("option")).toHaveText([/Glint/]);
	await expectFullyVisible(picker);

	await page.keyboard.press("Enter");
	await expect(picker).toHaveCount(0);
	await expect(runStatus(page, title)).toHaveText("Run requested");
	await expect(cardTitled(page, title).getByRole("button", { name: "Waiting for Glint" })).toBeVisible();
});

test("a search that fits no Bot says so, and Enter does not hand the card to Cursor instead", async ({ page, request }) => {
	await fillRoster(request);
	const title = `search none ${unique()}`;
	await tool(request, "create_card", { bot: "Atlas", title, repo: { url: "https://github.com/s-hiraoku/shift-log", startingRef: "main" } });
	await signIn(page);
	const before = ((await (await request.get(`${FAKE_CURSOR}/__agents`)).json()) as unknown[]).length;

	await cardTitled(page, title).getByRole("button", { name: /Run with a Grok Bot/ }).click();
	const picker = runPicker(page);
	await expect(picker.getByRole("option", { name: /Cursor agent/ })).toBeVisible();
	await picker.getByRole("combobox", { name: "Search bots" }).fill("zzz");
	await expect(picker).toContainText("No bot matches “zzz”.");
	await expect(picker.getByRole("option")).toHaveCount(0);
	await page.keyboard.press("Enter");
	await expect(picker).toBeVisible();
	expect(((await (await request.get(`${FAKE_CURSOR}/__agents`)).json()) as unknown[]).length).toBe(before);

	// Typing Cursor's name brings it back.
	await picker.getByRole("combobox", { name: "Search bots" }).fill("cur");
	await expect(picker.getByRole("option")).toHaveText([/Cursor agent/]);
	// Closing forgets the search.
	await page.keyboard.press("Escape");
	await cardTitled(page, title).getByRole("button", { name: /Run with a Grok Bot/ }).click();
	await expect(picker.getByRole("combobox", { name: "Search bots" })).toHaveValue("");
	expect(await picker.getByRole("option").count()).toBeGreaterThan(Object.keys(ROSTER).length);
});

test("the assignee list searches by name and role, and keeps the search while picking several", async ({ page, request }) => {
	await fillRoster(request);
	const title = `search assign ${unique()}`;
	await tool(request, "create_card", { bot: "Atlas", title });
	await signIn(page);
	await openCard(page, title);
	const fields = drawer(page).getByRole("complementary", { name: "Card fields" });
	await fields.getByRole("button", { name: "Edit" }).click();
	const picker = page.locator('[data-slot="assignee-menu"]');
	await expectFullyVisible(picker);
	const search = picker.getByRole("combobox", { name: "Search members" });
	await expect(search).toBeFocused();

	await search.fill("レビュー");
	await expect(picker.getByRole("option")).toHaveText([/Cipher/, /Glint/]);
	await picker.getByRole("option", { name: /Cipher/ }).click();
	await picker.getByRole("option", { name: /Glint/ }).click();
	await expect(fields.locator('[data-slot="assignees"]')).toContainText("Cipher");
	await expect(fields.locator('[data-slot="assignees"]')).toContainText("Glint");
	await expect(search).toHaveValue("レビュー");

	await search.fill("nobody here");
	await expect(picker).toContainText("No member matches “nobody here”.");
	// Clear assignees is not offered while searching, so Enter cannot clear them by accident.
	await expect(picker.getByRole("option", { name: "Clear assignees" })).toHaveCount(0);
	await page.keyboard.press("Enter");
	await expect(fields.locator('[data-slot="assignees"]')).toContainText("Glint");
	await search.fill("");
	await expect(picker.getByRole("option", { name: "Clear assignees" })).toBeVisible();
});

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

	test("the Bot lists open without the keyboard, fit the screen, and search once tapped", async ({ page, request }) => {
		await fillRoster(request);
		const title = `search phone ${unique()}`;
		await tool(request, "create_card", { bot: "Atlas", title });
		await signIn(page);

		const card = cardTitled(page, title);
		await card.scrollIntoViewIfNeeded();
		await card.getByRole("button", { name: /Run with a Grok Bot/ }).tap();
		const picker = runPicker(page);
		await expectFullyVisible(picker);
		const search = picker.getByRole("combobox", { name: "Search bots" });
		await expect(search).not.toBeFocused();
		await search.tap();
		await search.fill("ログ");
		await expect(picker.getByRole("option")).toHaveText([/Iris/]);
		await picker.getByRole("option", { name: /Iris/ }).tap();
		await expect(runStatus(page, title)).toHaveText("Run requested");

		await openCard(page, title);
		const edit = drawer(page).getByRole("complementary", { name: "Card fields" }).getByRole("button", { name: "Edit" });
		await edit.scrollIntoViewIfNeeded();
		await edit.tap();
		const assignees = page.locator('[data-slot="assignee-menu"]');
		await expectFullyVisible(assignees);
		await expect(assignees.getByRole("combobox", { name: "Search members" })).not.toBeFocused();
	});
});

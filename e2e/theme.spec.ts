import { expect, test, type Page } from "@playwright/test";
import { openMenu, signIn } from "./helpers";

const html = (page: Page) => page.locator("html");

test("the board follows the OS until a theme is picked, and keeps the pick after a reload", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await signIn(page);
	await expect(html(page)).not.toHaveClass(/\bdark\b/);
	await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible();

	// On System, the board turns dark with the OS, without a reload.
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(html(page)).toHaveClass(/\bdark\b/);

	await page.getByRole("button", { name: "Theme: System" }).click();
	await openMenu(page).getByRole("menuitemradio", { name: "Light" }).click();
	await expect(html(page)).not.toHaveClass(/\bdark\b/);
	await expect(page.getByRole("button", { name: "Theme: Light" })).toBeVisible();

	// The pick is applied before the first paint on the next load, and the OS no longer moves it.
	await page.reload();
	await expect(html(page)).not.toHaveClass(/\bdark\b/);
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");

	await page.getByRole("button", { name: "Theme: Light" }).click();
	await expect(openMenu(page).getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
	await openMenu(page).getByRole("menuitemradio", { name: "Dark" }).click();
	await page.emulateMedia({ colorScheme: "light" });
	await page.reload();
	await expect(html(page)).toHaveClass(/\bdark\b/);

	// Back to System hands it to the OS again.
	await page.getByRole("button", { name: "Theme: Dark" }).click();
	await openMenu(page).getByRole("menuitemradio", { name: "System" }).click();
	await expect(html(page)).not.toHaveClass(/\bdark\b/);
	expect(await page.evaluate(() => localStorage.getItem("kanban.theme"))).toBeNull();
});

test("the sign-in page uses the saved theme too", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.addInitScript(() => localStorage.setItem("kanban.theme", "light"));
	await page.goto("/login");
	await expect(html(page)).not.toHaveClass(/\bdark\b/);
});

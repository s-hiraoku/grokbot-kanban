// Playwright harness for journeys against the instance launch.sh started. Import it from a journey file:
//   import { journey, expect } from "../scripts/kanban.mjs";
//   await journey("create-card", { viewport: "desktop" }, async (s) => {   // signed in, evidence folder ready
//     await s.step("open New card", () => s.page.getByRole("button", { name: /New card/ }).click());
//     await s.shot("dialog-open");
//   });                                      // always writes trace.zip, video, steps.json, console.log
// Evidence lands in .verify/evidence/<time>-<name>/ and survives cleanup.sh.
import { chromium, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export { expect };
export const ROOT = execSync("git rev-parse --show-toplevel", { cwd: import.meta.dirname }).toString().trim();
const STATE = join(ROOT, ".verify/run");
if (!existsSync(join(STATE, "env"))) throw new Error("No instance from verify-kanban. Run .cursor/skills/verify-kanban/scripts/launch.sh first.");
const ENV = Object.fromEntries(readFileSync(join(STATE, "env"), "utf8").trim().split("\n").map((line) => line.split("=")));
export const BASE_URL = ENV.BASE_URL;
export const FAKE_CURSOR = `http://localhost:${ENV.CURSOR_PORT}`;
// Same values as common.sh.
export const OWNER_PASSWORD = "verify-owner-password-0123456789abcdefgh";
export const BOT_TOKEN = "verify-bot-token-0123456789abcdefghijklmnop";

export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, laptop: { width: 1280, height: 720 }, phone: { width: 390, height: 760 } };
export const unique = () => Math.random().toString(36).slice(2, 8);

/** Any MCP method, as a Grok Bot's connector sends it. */
export async function rpc(method, params = {}) {
	const response = await fetch(`${BASE_URL}/api/mcp`, {
		method: "POST",
		headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	if (!response.ok) throw new Error(`MCP ${method} answered ${response.status}`);
	return (await response.json()).result;
}

/** Calls an MCP tool as a Bot; `args.bot` is the Bot's name. Returns structuredContent, throws on a tool error. */
export async function tool(name, args) {
	const result = await rpc("tools/call", { name, arguments: args });
	if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
	return result.structuredContent;
}

// Locators, matching e2e/helpers.ts.
export const cardTitled = (page, title) => page.locator("[data-card-id]", { hasText: title });
export const columnOf = (page, title) => page.locator("section[data-column]", { has: cardTitled(page, title) });
export const column = (page, label) => page.locator(`section[data-column][aria-label="${label}"]`);
export const openCard = (page, title) => cardTitled(page, title).getByRole("heading", { name: title }).click();
export const drawer = (page) => page.locator('[data-slot="card-drawer"][data-state="open"]');
export const openMenu = (page) => page.locator('[role="menu"][data-state="open"]');
export const runStatus = (page, title) => cardTitled(page, title).locator('[data-slot="run-status"]');

/**
 * Drags a card with the mouse the way a person does: press on the card body, move past dnd-kit's 6px start
 * distance, glide to the target (a column section or a dock face button), release. Scrolls the card into view
 * first; a card below a column's fold has an off-screen box and the drag would select text instead.
 */
export async function dragCard(page, title, target) {
	const card = cardTitled(page, title).getByRole("heading", { name: title });
	await card.scrollIntoViewIfNeeded();
	const from = await card.boundingBox();
	const to = await target.boundingBox();
	await page.mouse.move(from.x + 20, from.y + 5);
	await page.mouse.down();
	await page.mouse.move(from.x + 40, from.y + 15, { steps: 5 });
	await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 120), { steps: 15 });
	await page.mouse.up();
}

/** Waits for running finite animations (a drawer sliding in, a menu fading) so a screenshot shows the end state. */
export async function settled(page) {
	await page.evaluate(() => Promise.all(document.getAnimations().filter((item) => item.effect?.getComputedTiming().iterations !== Infinity).map((item) => item.finished.catch(() => undefined))));
}

/** Signs in through the login form and waits until React owns the board, so clicks are not lost. */
export async function signIn(page) {
	await page.goto(`${BASE_URL}/login`);
	await page.getByLabel("Password").fill(OWNER_PASSWORD);
	await page.getByRole("button", { name: /Sign in/ }).click();
	await page.waitForURL(`${BASE_URL}/`);
	await page.getByRole("button", { name: /New card/ }).waitFor();
	await page.waitForFunction(() => {
		const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("New card"));
		return button !== undefined && Object.keys(button).some((key) => key.startsWith("__reactFiber"));
	});
	await page.waitForLoadState("networkidle");
}

/**
 * Opens a browser with video and tracing on and returns helpers that record every step. Not signed in yet.
 * Call finish() even after a failure (try/finally) so the trace and video are written; journey() does both.
 */
export async function session(name, { viewport = "desktop", headless = process.env.HEADED !== "1" } = {}) {
	const dir = join(ROOT, ".verify/evidence", `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}`);
	mkdirSync(dir, { recursive: true });
	const size = typeof viewport === "string" ? VIEWPORTS[viewport] : viewport;
	const browser = await chromium.launch({ headless });
	const context = await browser.newContext({ viewport: size, recordVideo: { dir, size }, permissions: ["clipboard-read", "clipboard-write"], baseURL: BASE_URL });
	await context.tracing.start({ screenshots: true, snapshots: true });
	const page = await context.newPage();
	const log = join(dir, "console.log");
	page.on("console", (message) => appendFileSync(log, `[${message.type()}] ${message.text()}\n`));
	page.on("pageerror", (error) => appendFileSync(log, `[pageerror] ${error.message}\n`));
	const steps = [];
	let shots = 0;
	const s = {
		dir, page, context, tool, rpc,
		/** Full-page screenshot named NN-label.png, taken once drawers and menus have finished animating. */
		async shot(label) {
			await settled(page);
			const file = join(dir, `${String(++shots).padStart(2, "0")}-${label}.png`);
			await page.screenshot({ path: file, fullPage: true });
			return file;
		},
		/** Runs one user-visible action or check and records whether it held. */
		async step(text, action) {
			const started = Date.now();
			try {
				const value = await action();
				steps.push({ step: text, ok: true, ms: Date.now() - started });
				console.log(`  ok   ${text}`);
				return value;
			} catch (error) {
				steps.push({ step: text, ok: false, ms: Date.now() - started, error: String(error.message ?? error).split("\n").slice(0, 6).join("\n") });
				console.log(`  FAIL ${text}\n${error.message}`);
				await s.shot("failure").catch(() => {});
				throw error;
			}
		},
		/** Saves a JSON side-effect snapshot (an MCP read, a fake-Cursor list) next to the screenshots. */
		save(label, data) {
			writeFileSync(join(dir, `${label}.json`), JSON.stringify(data, null, 2));
		},
		async finish() {
			await context.tracing.stop({ path: join(dir, "trace.zip") }).catch(() => {});
			await context.close();
			await browser.close();
			const passed = steps.length > 0 && steps.every((item) => item.ok);
			writeFileSync(join(dir, "steps.json"), JSON.stringify({ name, viewport: size, baseURL: BASE_URL, passed, steps }, null, 2));
			console.log(`${passed ? "PASSED" : "FAILED"} ${name}. Evidence: ${dir}`);
			return passed;
		},
	};
	return s;
}

/** Runs a journey body in a session signed in as the owner (unless `signedIn: false`), always finishing it; exits 1 on failure. */
export async function journey(name, { signedIn = true, ...options }, body) {
	const s = await session(name, options);
	let failed = false;
	try {
		if (signedIn) await s.step("sign in as the owner", () => signIn(s.page));
		await body(s);
	} catch {
		failed = true;
	} finally {
		const passed = await s.finish();
		process.exitCode = failed || !passed ? 1 : 0;
	}
}

import { defineConfig } from "@playwright/test";

// Browser tests for the board. They build the app and serve it on an in-memory PGlite database, so they
// exercise what ships, without the dev server's reloads. Stop `next dev` first, as both use .next.
const PORT = 3210;
const FAKE_CURSOR = "http://localhost:3299";
const FAKE_GITHUB = "http://localhost:3298";

export default defineConfig({
	testDir: "e2e",
	timeout: 60_000,
	use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 } },
	webServer: [
		{
			// Cursor's API, played by a small local server so Run with Cursor can be driven end to end.
			command: "node e2e/fake-cursor.mjs",
			url: `${FAKE_CURSOR}/__agents`,
			reuseExistingServer: false,
			env: { PORT: "3299" },
		},
		{
			// GitHub sign-in, played the same way, so tests sign in without a real account.
			command: "node e2e/fake-github.mjs",
			url: `${FAKE_GITHUB}/__health`,
			reuseExistingServer: false,
			env: { PORT: "3298" },
		},
		{
			command: `npx next build && npx next start -p ${PORT}`,
			url: `http://localhost:${PORT}/login`,
			timeout: 300_000,
			reuseExistingServer: false,
			env: {
				DATABASE_URL: "pglite",
				GITHUB_CLIENT_ID: "e2e-client-id",
				GITHUB_CLIENT_SECRET: "e2e-github-secret-0123456789abcdefghijklmn",
				OWNER_GITHUB_LOGIN: "s-hiraoku",
				GITHUB_WEB_URL: FAKE_GITHUB,
				GITHUB_API_URL: FAKE_GITHUB,
				BOT_TOKEN: "e2e-bot-token-0123456789abcdefghijklmnopq",
				CURSOR_API_KEY: "e2e-cursor-key-0123456789abcdefghijklmnop",
				CURSOR_API_URL: FAKE_CURSOR,
			},
		},
	],
});

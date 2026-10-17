import { defineConfig } from "@playwright/test";

// Browser tests for the board. They build the app and serve it on an in-memory PGlite database, so they
// exercise what ships, without the dev server's reloads. Stop `next dev` first, as both use .next.
const PORT = 3210;

export default defineConfig({
	testDir: "e2e",
	timeout: 60_000,
	use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 } },
	webServer: {
		command: `npx next build && npx next start -p ${PORT}`,
		url: `http://localhost:${PORT}/login`,
		timeout: 300_000,
		reuseExistingServer: false,
		env: {
			DATABASE_URL: "pglite",
			OWNER_PASSWORD: "e2e-owner-password-0123456789abcdefghij",
			BOT_TOKEN: "e2e-bot-token-0123456789abcdefghijklmnopq",
		},
	},
});

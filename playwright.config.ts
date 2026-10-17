import { defineConfig } from "@playwright/test";

// Browser tests for the board. They start their own dev server on an in-memory PGlite database.
const PORT = 3210;

export default defineConfig({
	testDir: "e2e",
	timeout: 60_000,
	use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 } },
	webServer: {
		command: `npx next dev -p ${PORT}`,
		url: `http://localhost:${PORT}/login`,
		timeout: 180_000,
		reuseExistingServer: false,
		env: {
			DATABASE_URL: "pglite",
			OWNER_PASSWORD: "e2e-owner-password-0123456789abcdefghij",
			BOT_TOKEN: "e2e-bot-token-0123456789abcdefghijklmnopq",
		},
	},
});

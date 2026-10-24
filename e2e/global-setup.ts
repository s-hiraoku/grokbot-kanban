import { request } from "@playwright/test";

// The old shared BOT_TOKEN opens the owner's board, which exists once the owner has signed in. Sign in once
// before the tests, as production has, so tests that file cards before signing in have a board to file to.
export default async function globalSetup() {
	const context = await request.newContext({ baseURL: "http://localhost:3210" });
	const response = await context.get("/api/auth/github");
	if (!response.url().endsWith("/")) throw new Error(`owner sign-in ended at ${response.url()}`);
	await context.dispose();
}

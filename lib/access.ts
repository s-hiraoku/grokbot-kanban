import type { Env } from "./runtime";

/** Whether this account may use a board: the owner, and whoever ALLOWED_GITHUB_LOGINS lets in. */
export function mayUseBoard(login: string, config: Env): boolean {
	return isOwnerLogin(login, config) || config.allowedGithubLogins === "*" || config.allowedGithubLogins.includes(login.toLowerCase());
}

/** The owner keeps the board from before accounts, the old shared BOT_TOKEN, and CURSOR_API_KEY. */
export function isOwnerLogin(login: string, config: Env): boolean {
	return login.toLowerCase() === config.ownerGithubLogin.toLowerCase();
}

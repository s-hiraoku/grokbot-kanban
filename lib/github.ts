import type { GitHubProfile } from "./accounts";

const TIMEOUT_MS = 10_000;

/** Why sign-in sent the browser back to /login. */
export type SignInError = "state" | "denied" | "github" | "not_allowed";

export function callbackUrl(req: Request): string {
	return new URL("/api/auth/github/callback", req.url).toString();
}

export type GitHubOAuth = {
	authorizeUrl(options: { redirectUri: string; state: string; challenge: string }): string;
	/** Trades the code GitHub sent back for the user's profile, or null when GitHub refuses it. */
	profileFor(options: { code: string; verifier: string; redirectUri: string }): Promise<GitHubProfile | null>;
};

export function createGitHubOAuth(options: {
	clientId: string;
	clientSecret: string;
	/** github.com, unless the browser tests point it at a stand-in. */
	webUrl?: string;
	apiUrl?: string;
	fetch?: typeof fetch;
}): GitHubOAuth {
	const web = (options.webUrl ?? "https://github.com").replace(/\/$/, "");
	const api = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
	const fetchImpl = options.fetch ?? fetch;
	return {
		authorizeUrl({ redirectUri, state, challenge }) {
			const url = new URL(`${web}/login/oauth/authorize`);
			url.search = new URLSearchParams({
				client_id: options.clientId,
				redirect_uri: redirectUri,
				state,
				code_challenge: challenge,
				code_challenge_method: "S256",
				// No scope: the public profile is all the board reads.
				scope: "",
			}).toString();
			return url.toString();
		},

		async profileFor({ code, verifier, redirectUri }) {
			const exchange = await fetchImpl(`${web}/login/oauth/access_token`, {
				method: "POST",
				headers: { Accept: "application/json", "Content-Type": "application/json" },
				body: JSON.stringify({ client_id: options.clientId, client_secret: options.clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier }),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!exchange.ok) return null;
			const grant = (await exchange.json()) as { access_token?: unknown };
			if (typeof grant.access_token !== "string" || !grant.access_token) return null;
			const response = await fetchImpl(`${api}/user`, {
				headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${grant.access_token}`, "User-Agent": "grokbot-kanban", "X-GitHub-Api-Version": "2022-11-28" },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!response.ok) return null;
			const user = (await response.json()) as { id?: unknown; login?: unknown; name?: unknown; avatar_url?: unknown };
			if (typeof user.id !== "number" || typeof user.login !== "string") return null;
			return {
				id: user.id,
				login: user.login,
				name: typeof user.name === "string" && user.name ? user.name : null,
				avatarUrl: typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://") ? user.avatar_url : null,
			};
		},
	};
}

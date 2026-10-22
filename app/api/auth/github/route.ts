import { pkceChallenge, randomToken, signInCookie } from "@/lib/auth";
import { requestIsSecure } from "@/lib/http";
import { callbackUrl } from "@/lib/github";
import { getGitHub } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends the browser to GitHub to sign in. The state and PKCE verifier wait in a short-lived cookie. */
export async function GET(req: Request): Promise<Response> {
	const state = randomToken();
	const verifier = randomToken();
	const location = getGitHub().authorizeUrl({ redirectUri: callbackUrl(req), state, challenge: pkceChallenge(verifier) });
	return new Response(null, {
		status: 302,
		headers: { Location: location, "Set-Cookie": signInCookie(state, verifier, requestIsSecure(req)), "Cache-Control": "no-store" },
	});
}

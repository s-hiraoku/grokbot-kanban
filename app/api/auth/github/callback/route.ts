import { SIGN_IN_COOKIE, clearedSignInCookie, sessionCookie, tokenFromCookie, verifierFor } from "@/lib/auth";
import { callbackUrl, type SignInError } from "@/lib/github";
import { isOwnerLogin, mayUseBoard } from "@/lib/access";
import { requestIsSecure } from "@/lib/http";
import { env, getAccounts, getGitHub } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub sends the browser back here. A session starts only for a state we issued and an account let in. */
export async function GET(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const secure = requestIsSecure(req);
	const fail = (error: SignInError) => redirect(new URL(`/login?error=${error}`, req.url), [clearedSignInCookie(secure)]);

	const verifier = verifierFor(tokenFromCookie(req.headers.get("cookie"), SIGN_IN_COOKIE), url.searchParams.get("state"));
	if (!verifier) return fail("state");
	if (url.searchParams.get("error") === "access_denied") return fail("denied");
	const code = url.searchParams.get("code");
	if (!code) return fail("github");

	const config = env();
	let profile;
	try {
		profile = await getGitHub(config).profileFor({ code, verifier, redirectUri: callbackUrl(req) });
	} catch {
		profile = null;
	}
	if (!profile) return fail("github");
	if (!mayUseBoard(profile.login, config)) return fail("not_allowed");

	const accounts = getAccounts();
	const { token, user } = await accounts.signIn(profile, Date.now());
	if (isOwnerLogin(user.login, config)) await accounts.claimUnowned(user.id);
	return redirect(new URL("/", req.url), [sessionCookie(token, secure), clearedSignInCookie(secure)]);
}

function redirect(location: URL, cookies: string[]): Response {
	const headers = new Headers({ Location: location.toString(), "Cache-Control": "no-store" });
	for (const cookie of cookies) headers.append("Set-Cookie", cookie);
	return new Response(null, { status: 303, headers });
}

import { clearedSessionCookie, tokenFromCookie } from "@/lib/auth";
import { forbidden, requestIsSecure, sameOrigin } from "@/lib/http";
import { getAccounts } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends this browser's session on the server too, so the old cookie stops working even if it was copied. */
export async function POST(req: Request): Promise<Response> {
	if (!sameOrigin(req)) return forbidden();
	await getAccounts().signOut(tokenFromCookie(req.headers.get("cookie")));
	return new Response(null, {
		status: 303,
		headers: {
			Location: new URL("/login", req.url).toString(),
			"Set-Cookie": clearedSessionCookie(requestIsSecure(req)),
		},
	});
}

import { logoutCookie, sameOrigin, forbidden } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
	if (!sameOrigin(req)) return forbidden();
	return new Response(null, {
		status: 303,
		headers: {
			Location: new URL("/login", req.url).toString(),
			"Set-Cookie": logoutCookie(req),
		},
	});
}

import { checkPassword } from "@/lib/auth";
import { forbidden, loginCookie, sameOrigin } from "@/lib/http";
import { env } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
	if (!sameOrigin(req)) return forbidden();
	const form = await req.formData();
	const password = String(form.get("password") ?? "");
	const config = env();
	const login = new URL("/login", req.url);
	if (!checkPassword(password, config.ownerPassword)) {
		login.searchParams.set("error", "1");
		return redirect(login, null);
	}
	return redirect(new URL("/", req.url), loginCookie(config, req));
}

function redirect(location: URL, cookie: string | null): Response {
	const headers = new Headers({ Location: location.toString() });
	if (cookie) headers.set("Set-Cookie", cookie);
	return new Response(null, { status: 303, headers });
}

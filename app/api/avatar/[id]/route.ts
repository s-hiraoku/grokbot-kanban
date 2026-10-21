import { env, getBoard } from "@/lib/runtime";
import { notFound, ownerFromRequest, unauthorized } from "@/lib/http";
import { isAvatarData } from "@/lib/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves an icon the owner uploaded. The URL carries a content hash, so the browser can keep it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	const owner = await ownerFromRequest(req, env());
	if (!owner) return unauthorized();
	const { id } = await params;
	const avatar = await getBoard().owner(owner).avatar(decodeURIComponent(id));
	if (!avatar || !isAvatarData(avatar)) return notFound();
	const comma = avatar.indexOf(",");
	const type = avatar.slice("data:".length, avatar.indexOf(";"));
	return new Response(Buffer.from(avatar.slice(comma + 1), "base64"), {
		headers: {
			"Content-Type": type,
			"Cache-Control": "private, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

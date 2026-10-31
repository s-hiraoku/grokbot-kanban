import { boardEtag, json, requireOwner, revisionFromEtag } from "@/lib/http";
import { env, getBoard } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
	const config = env();
	const owner = await requireOwner(req, config);
	if (owner instanceof Response) return owner;
	const result = await getBoard(owner.user).owner(owner.cap).sync(revisionFromEtag(req.headers.get("if-none-match")));
	if (result.unchanged) return new Response(null, { status: 304, headers: { ETag: boardEtag(result.revision) } });
	return json(result.board, 200, { ETag: boardEtag(result.revision) });
}

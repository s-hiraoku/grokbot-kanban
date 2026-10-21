import { json, requireOwner } from "@/lib/http";
import { env, getBoard } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
	const config = env();
	const owner = await requireOwner(req, config);
	if (owner instanceof Response) return owner;
	const board = await getBoard().owner(owner).view();
	return json(board);
}

import { json, readJson, requireBot } from "@/lib/http";
import { handleMcp } from "@/lib/mcp";
import { BadRequest } from "@/lib/parse";
import { env, getBoard } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
	const config = env();
	const bot = requireBot(req, config);
	if (bot instanceof Response) return bot;
	let payload: unknown;
	try {
		payload = await readJson(req);
	} catch (error) {
		if (error instanceof BadRequest) {
			return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
		}
		throw error;
	}
	const answer = await handleMcp({ board: getBoard().bot(bot), boardUrl: new URL(req.url).origin }, payload);
	if (answer.status === 202) return new Response(null, { status: 202 });
	return json(answer.body, answer.status);
}

// This server keeps no sessions and never pushes, so there is no SSE stream to open or session to end.
// Auth is checked first: a client without the token that falls back to GET should see 401, not a misleading 405.
export async function GET(req: Request): Promise<Response> {
	return notAllowed(req);
}

export async function DELETE(req: Request): Promise<Response> {
	return notAllowed(req);
}

function notAllowed(req: Request): Response {
	const bot = requireBot(req, env());
	if (bot instanceof Response) return bot;
	return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

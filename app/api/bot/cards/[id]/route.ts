import type { CardId } from "@/lib/domain";
import { BoardInputError } from "@/lib/board";
import { badRequest, botNameFrom, json, notFound, readJson, requireBot } from "@/lib/http";
import { BadRequest, brandPatch, contentPatchSchema, parseBody } from "@/lib/parse";
import { env, getBoard } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context): Promise<Response> {
	const config = env();
	const bot = requireBot(req, config);
	if (bot instanceof Response) return bot;
	const { id } = await context.params;
	const card = await getBoard().bot(bot).get(id as CardId);
	if (!card) return notFound();
	return json({ card });
}

export async function PATCH(req: Request, context: Context): Promise<Response> {
	const config = env();
	const bot = requireBot(req, config);
	if (bot instanceof Response) return bot;
	const { id } = await context.params;
	try {
		const patch = brandPatch(parseBody(contentPatchSchema, await readJson(req)));
		const card = await getBoard().bot(bot).patch(id as CardId, patch, botNameFrom(req));
		if (!card) return notFound();
		return json({ card });
	} catch (error) {
		if (error instanceof BadRequest) return badRequest();
		if (error instanceof BoardInputError) return badRequest(error.message);
		throw error;
	}
}

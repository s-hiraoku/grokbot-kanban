import { BoardInputError } from "@/lib/board";
import { badRequest, botNameFrom, json, readJson, requireBot } from "@/lib/http";
import { BadRequest, contentFromNewCard, newCardBodySchema, parseBody } from "@/lib/parse";
import { env, getBoard } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
	const config = env();
	const bot = requireBot(req, config);
	if (bot instanceof Response) return bot;
	try {
		const raw = parseBody(newCardBodySchema, await readJson(req));
		const result = await getBoard().bot(bot).create({
			externalId: raw.externalId ?? null,
			content: contentFromNewCard(raw),
		}, botNameFrom(req));
		return json({ card: result.card }, result.created ? 201 : 200);
	} catch (error) {
		if (error instanceof BadRequest) return badRequest();
		if (error instanceof BoardInputError) return badRequest(error.message);
		throw error;
	}
}

import type { OwnerCommand } from "@/lib/board";
import { badRequest, json, readJson, requireOwner } from "@/lib/http";
import { BadRequest, brandContent, brandPatch, ownerCommandSchema, parseBody } from "@/lib/parse";
import { env, getBoard } from "@/lib/runtime";
import type { CardId } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
	const config = env();
	const owner = await requireOwner(req, config);
	if (owner instanceof Response) return owner;
	try {
		const command = toCommand(parseBody(ownerCommandSchema, await readJson(req)));
		const result = await getBoard().owner(owner).execute(command);
		if (result.error === "not_found") return json({ error: "not_found", board: result.board, notice: "That card or bot no longer exists. The board was refreshed." }, 404);
		if (result.error === "busy") return json({ error: "busy", notice: "Someone else changed this card at the same moment. Try again." }, 503);
		if (result.error === "bad_request") return json({ error: "bad_request", board: result.board, notice: result.notice }, 400);
		return json({ board: result.board, notice: result.notice });
	} catch (error) {
		if (error instanceof BadRequest) return badRequest();
		throw error;
	}
}

function toCommand(raw: ReturnType<typeof ownerCommandSchema.parse>): OwnerCommand {
	if (raw.type === "create") return { type: "create", content: brandContent(raw.content) };
	if (raw.type === "edit") return { type: "edit", cardId: raw.cardId as CardId, patch: brandPatch(raw.patch) };
	if (raw.type === "move") return { type: "move", cardId: raw.cardId as CardId, to: raw.to };
	if (raw.type === "run") return { type: "run", cardId: raw.cardId as CardId, bot: raw.bot };
	if (raw.type === "cursor") return { type: "cursor", cardId: raw.cardId as CardId };
	if (raw.type === "stop") return { type: "stop", cardId: raw.cardId as CardId };
	if (raw.type === "drop") return { type: "drop", cardId: raw.cardId as CardId, column: raw.column, index: raw.index };
	if (raw.type === "saveBot") return { type: "saveBot", id: raw.id, profile: raw.profile };
	if (raw.type === "deleteBot") return { type: "deleteBot", id: raw.id };
	if (raw.type === "deleteCard") return { type: "deleteCard", cardId: raw.cardId as CardId };
	return { type: "setOwnerAvatar", avatar: raw.avatar || null };
}

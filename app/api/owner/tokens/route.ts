import { badRequest, json, ownerFromRequest, readJson, requireOwner, unauthorized } from "@/lib/http";
import { BadRequest } from "@/lib/parse";
import { env, getAccounts } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOKENS = 20;

/**
 * The signed-in user's connector tokens, without the tokens themselves. Browsers send no Origin on a same-origin
 * GET, so this read skips the same-origin check that writes need; another site cannot read the answer anyway.
 */
export async function GET(req: Request): Promise<Response> {
	const owner = await ownerFromRequest(req, env());
	if (!owner) return unauthorized();
	return json({ tokens: await getAccounts().botTokens(owner.user.id) });
}

/** Makes a connector token. The response is the only time the token is shown. */
export async function POST(req: Request): Promise<Response> {
	const owner = await requireOwner(req, env());
	if (owner instanceof Response) return owner;
	let body: unknown;
	try {
		body = await readJson(req);
	} catch (error) {
		if (error instanceof BadRequest) return badRequest();
		throw error;
	}
	const raw = (body as { label?: unknown }).label;
	if (raw !== undefined && typeof raw !== "string") return badRequest("label must be text");
	const label = (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim() || "Grok Bot";
	if (label.length > 40) return badRequest("Keep the name to 40 characters.");
	const accounts = getAccounts();
	if ((await accounts.botTokens(owner.user.id)).length >= MAX_TOKENS) return badRequest(`A board can have up to ${MAX_TOKENS} tokens. Revoke one you no longer use first.`);
	const made = await accounts.createBotToken(owner.user.id, label, Date.now());
	return json(made, 201);
}

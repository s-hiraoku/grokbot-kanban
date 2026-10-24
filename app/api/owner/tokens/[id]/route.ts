import { json, notFound, requireOwner } from "@/lib/http";
import { env, getAccounts } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revokes one of the signed-in user's connector tokens. Calls with it are refused from then on. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	const owner = await requireOwner(req, env());
	if (owner instanceof Response) return owner;
	const { id } = await params;
	if (!(await getAccounts().revokeBotToken(owner.user.id, id))) return notFound();
	return json({ tokens: await getAccounts().botTokens(owner.user.id) });
}

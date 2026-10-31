import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Board from "@/components/Board";
import { SESSION_COOKIE, mintOwner } from "@/lib/auth";
import { canUseBoard } from "@/lib/http";
import { env, getAccounts, getBoard } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
	const config = env();
	const jar = await cookies();
	const user = await getAccounts().userFor(jar.get(SESSION_COOKIE)?.value, Date.now());
	if (!canUseBoard(user, config)) redirect("/login");
	const board = await getBoard(user).owner(mintOwner()).view();
	return <Board initial={board} studioUrl={config.studioUrl} />;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Board from "@/components/Board";
import { SESSION_COOKIE, mintOwner, readSession } from "@/lib/auth";
import { env, getBoard } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
	const config = env();
	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	if (!readSession(token, config.ownerPassword, Date.now())) redirect("/login");
	const board = await getBoard().owner(mintOwner()).view();
	return <Board initial={board} studioUrl={config.studioUrl} />;
}

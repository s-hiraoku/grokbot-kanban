import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SESSION_COOKIE } from "@/lib/auth";
import type { SignInError } from "@/lib/github";
import { isOwnerAccount } from "@/lib/http";
import { env, getAccounts } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MESSAGES: Record<SignInError, string> = {
	state: "That sign-in link expired or came from somewhere else. Try again.",
	denied: "GitHub sign-in was cancelled.",
	github: "GitHub did not confirm the sign-in. Try again in a moment.",
	not_allowed: "This board belongs to another GitHub account.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
	const jar = await cookies();
	if (isOwnerAccount(await getAccounts().userFor(jar.get(SESSION_COOKIE)?.value, Date.now()), env())) redirect("/");
	const { error } = await searchParams;
	const message = error && error in MESSAGES ? MESSAGES[error as SignInError] : null;
	return (
		<main className="grid min-h-dvh place-items-center p-4">
			<Card className="w-full max-w-[380px] gap-5 bg-deck">
				<CardHeader>
					<p className="text-xl font-bold tracking-tight">Grok Bot Kanban</p>
					<CardTitle className="text-base font-normal text-muted-foreground">
						<h1>Sign in to the board</h1>
					</CardTitle>
					<CardDescription>Use the GitHub account this board belongs to.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					{message ? (
						<p role="alert" className="text-[13px] text-destructive">
							{message}
						</p>
					) : null}
					<Button asChild size="lg">
						{/* A plain link: sign-in leaves for github.com, so there is nothing for React to do. */}
						<a href="/api/auth/github">
							<GitHubMark />
							Sign in with GitHub
						</a>
					</Button>
				</CardContent>
			</Card>
		</main>
	);
}

function GitHubMark() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

"use client";

import { Button } from "@/components/ui/button";

/** Shown when the board cannot load, for example while the database is unreachable. */
export default function BoardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<main className="grid min-h-dvh place-items-center p-4">
			<div className="grid max-w-sm gap-3 text-center" role="alert">
				<p className="text-xl font-bold tracking-tight">Grok Bot Kanban</p>
				<h1 className="text-base font-bold">The board could not load</h1>
				<p className="text-[13px] text-muted-foreground">The server or its database did not answer. Nothing was lost; try again in a moment.</p>
				<Button className="justify-self-center" onClick={reset}>
					Try again
				</Button>
			</div>
		</main>
	);
}

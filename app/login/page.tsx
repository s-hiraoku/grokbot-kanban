import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const params = await searchParams;
	const failed = params.error === "1";
	return (
		<main className="grid min-h-dvh place-items-center p-4">
			<Card className="w-full max-w-[380px] gap-5 bg-deck">
				<CardHeader>
					<p className="text-xl font-bold tracking-tight">Grok Bot Kanban</p>
					<CardTitle className="text-base font-normal text-muted-foreground">
						<h1>Sign in to the board</h1>
					</CardTitle>
					<CardDescription>This board is for the studio owner.</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="grid gap-4" method="post" action="/api/auth/login">
						<div className="grid gap-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="current-password"
								required
								autoFocus
								aria-invalid={failed || undefined}
								aria-describedby={failed ? "password-error" : undefined}
								className="bg-background dark:bg-background"
							/>
							{failed ? (
								<p id="password-error" role="alert" className="text-[13px] text-destructive">
									That password did not match. Try again.
								</p>
							) : null}
						</div>
						<Button type="submit" size="lg">
							Sign in
						</Button>
					</form>
				</CardContent>
			</Card>
		</main>
	);
}

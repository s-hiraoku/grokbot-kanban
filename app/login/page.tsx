export const dynamic = "force-dynamic";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const params = await searchParams;
	const failed = params.error === "1";
	return (
		<main className="login">
			<form className="login-card" method="post" action="/api/auth/login">
				<p className="eyebrow">Grok Bot</p>
				<h1>Sign in</h1>
				<p className="muted">This board is for the studio owner.</p>
				<label>
					Password
					<input name="password" type="password" autoComplete="current-password" required />
				</label>
				{failed ? <p className="error">That password did not match.</p> : null}
				<button type="submit">Enter</button>
			</form>
		</main>
	);
}

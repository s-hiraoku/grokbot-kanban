// A stand-in for GitHub's OAuth pages and user API, for the browser tests. It approves at once as the owner, or as
// the browser's fake_github_as cookie says ({login, id} or {deny: true}), so parallel tests don't see each other's
// choice. It checks the client and PKCE as GitHub does.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3298);
const OWNER = { id: 18750282, login: "s-hiraoku", name: "Hiraoku" };
const grants = new Map();
let serial = 1;

const send = (res, status, body) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};
const read = (req) =>
	new Promise((resolve) => {
		let text = "";
		req.on("data", (chunk) => (text += chunk));
		req.on("end", () => resolve(text ? JSON.parse(text) : {}));
	});

const chosen = (header = "") => {
	const raw = header.split(";").map((part) => part.trim()).find((part) => part.startsWith("fake_github_as="));
	return raw ? JSON.parse(decodeURIComponent(raw.slice("fake_github_as=".length))) : {};
};

createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${port}`);
	if (url.pathname === "/__health") return send(res, 200, { ok: true });
	if (req.method === "GET" && url.pathname === "/login/oauth/authorize") {
		const as = chosen(req.headers.cookie);
		const back = new URL(url.searchParams.get("redirect_uri"));
		back.searchParams.set("state", url.searchParams.get("state") ?? "");
		if (as.deny) {
			back.searchParams.set("error", "access_denied");
		} else {
			const code = `code-${serial++}`;
			grants.set(code, { user: as.login ? { id: as.id ?? 1, login: as.login, name: null } : OWNER, challenge: url.searchParams.get("code_challenge"), clientId: url.searchParams.get("client_id") });
			back.searchParams.set("code", code);
		}
		res.writeHead(302, { Location: back.toString() });
		return res.end();
	}
	if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
		const body = await read(req);
		const grant = grants.get(body.code);
		grants.delete(body.code);
		const verified = grant && grant.clientId === body.client_id && createHash("sha256").update(body.code_verifier ?? "").digest("base64url") === grant.challenge;
		if (!verified || body.client_secret !== "e2e-github-secret-0123456789abcdefghijklmn") return send(res, 200, { error: "bad_verification_code" });
		const token = `gho_${body.code}`;
		grants.set(token, grant);
		return send(res, 200, { access_token: token, token_type: "bearer", scope: "" });
	}
	if (req.method === "GET" && url.pathname === "/user") {
		const grant = grants.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
		if (!grant) return send(res, 401, { message: "Bad credentials" });
		const { id, login, name } = grant.user;
		return send(res, 200, { id, login, name, avatar_url: `https://avatars.githubusercontent.com/u/${id}` });
	}
	send(res, 404, { message: "Not Found" });
}).listen(port);

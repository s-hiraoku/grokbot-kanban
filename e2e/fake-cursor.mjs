// A stand-in for Cursor's Cloud Agents API, for the browser tests. It keeps agents in memory.
// POST /__state {agentId, status, prUrl} sets what the next run read returns; GET /__agents lists launches.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3299);
const agents = new Map();
let next = 1;

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

createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${port}`);
	if (req.method === "GET" && url.pathname === "/__agents") return send(res, 200, [...agents.values()]);
	if (req.method === "POST" && url.pathname === "/__state") {
		const body = await read(req);
		const agent = agents.get(body.agentId) ?? [...agents.values()].at(-1);
		if (!agent) return send(res, 404, { error: "no agent" });
		Object.assign(agent, { status: body.status, prUrl: body.prUrl ?? null });
		return send(res, 200, agent);
	}
	if (req.headers.authorization !== "Bearer e2e-cursor-key-0123456789abcdefghijklmnop") return send(res, 401, { error: "bad key" });
	if (req.method === "POST" && url.pathname === "/v1/agents") {
		const body = await read(req);
		const repo = body.repos?.[0]?.url ?? "";
		if (repo.includes("no-access")) return send(res, 400, { error: { message: "Repository not accessible", code: "repo_access" } });
		const id = `bc-${next++}`;
		const agent = { id, runId: `run-${id}`, url: `https://cursor.com/agents/${id}`, repo, prompt: body.prompt?.text ?? "", status: "RUNNING", prUrl: null };
		agents.set(id, agent);
		return send(res, 201, { agent: { id, url: agent.url, status: "ACTIVE", latestRunId: agent.runId }, run: { id: agent.runId, status: "CREATING" } });
	}
	const match = url.pathname.match(/^\/v1\/agents\/([^/]+)\/runs\/([^/]+)(\/cancel)?$/);
	const agent = match ? agents.get(match[1]) : null;
	if (!agent) return send(res, 404, { error: "not found" });
	if (match[3] && req.method === "POST") {
		if (agent.status !== "RUNNING") return send(res, 409, { error: "run_not_cancellable" });
		agent.status = "CANCELLED";
		return send(res, 200, { id: agent.runId });
	}
	const branches = agent.prUrl ? [{ repoUrl: agent.repo.replace(/^https:\/\//, ""), branch: "cursor/fix", prUrl: agent.prUrl }] : [];
	return send(res, 200, { id: agent.runId, agentId: agent.id, status: agent.status, git: { branches } });
}).listen(port, () => console.log(`fake cursor on ${port}`));

import { z } from "zod";
import { CHECK_TIMEOUT_MS, CREATE_TIMEOUT_MS, repoKey, type AgentRef, type HttpsUrl, type RepoRef } from "./domain";

/**
 * Cursor's Cloud Agents API (https://cursor.com/docs/cloud-agent/api/endpoints). The board creates an
 * agent with autoCreatePR, then reads the run while someone has the board open. It never holds the SSE
 * stream open, because a serverless function cannot stay connected for a whole run.
 */

export type AgentRequest = { promptText: string; repo: RepoRef; name: string };

export type CreateResult =
	| { kind: "created"; agent: AgentRef }
	| { kind: "rejected"; message: string }
	| { kind: "unknown"; message: string };

export type RunObservation =
	| { phase: "active"; status: string }
	| { phase: "ended"; outcome: "finished" | "error" | "cancelled" | "expired"; pullRequests: { repoKey: string; url: HttpsUrl }[] };

export type CancelResult = "requested" | "notCancellable" | "unreachable";

export type CursorClient = {
	createAgent(request: AgentRequest): Promise<CreateResult>;
	getRun(agent: AgentRef): Promise<RunObservation | "unreachable">;
	cancelRun(agent: AgentRef): Promise<CancelResult>;
};

const createResponse = z.object({
	agent: z.object({ id: z.string().min(1), latestRunId: z.string().optional(), url: z.string().url() }),
	run: z.object({ id: z.string().min(1) }).optional(),
});

const runResponse = z.object({
	status: z.string(),
	git: z
		.object({
			branches: z.array(z.object({ repoUrl: z.string(), prUrl: z.string().url().nullish() })).default([]),
		})
		.nullish(),
});

const ENDED: Record<string, "finished" | "error" | "cancelled" | "expired"> = {
	FINISHED: "finished",
	ERROR: "error",
	CANCELLED: "cancelled",
	EXPIRED: "expired",
};

export function createCursorClient(options: { apiKey: string; fetch?: typeof fetch; baseUrl?: string }): CursorClient {
	const fetchImpl = options.fetch ?? fetch;
	const base = (options.baseUrl ?? "https://api.cursor.com").replace(/\/$/, "");
	const headers = { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
	const runPath = (agent: AgentRef) => `${base}/v1/agents/${encodeURIComponent(agent.agentId)}/runs/${encodeURIComponent(agent.runId)}`;

	return {
		async createAgent(request) {
			let response: Response;
			try {
				response = await fetchImpl(`${base}/v1/agents`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						name: request.name.slice(0, 100),
						prompt: { text: request.promptText },
						repos: [{ url: request.repo.url, startingRef: request.repo.startingRef }],
						autoCreatePR: true,
					}),
					signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
				});
			} catch (error) {
				return { kind: "unknown", message: error instanceof Error ? error.message : "network error" };
			}
			if (response.status === 401 || response.status === 403) {
				return { kind: "rejected", message: `Cursor refused the API key (${response.status}). Check CURSOR_API_KEY.` };
			}
			if (response.status >= 400 && response.status < 500) {
				const reason = await errorReason(response);
				return { kind: "rejected", message: `Cursor refused the launch (${response.status})${reason ? `: ${reason}` : "."}` };
			}
			if (!response.ok) return { kind: "unknown", message: `Cursor returned ${response.status}.` };
			const parsed = createResponse.safeParse(await response.json().catch(() => null));
			const runId = parsed.success ? (parsed.data.run?.id ?? parsed.data.agent.latestRunId) : undefined;
			if (!parsed.success || !runId || !parsed.data.agent.url.startsWith("https://")) {
				return { kind: "unknown", message: "Cursor answered, but not in a shape the board can read." };
			}
			return {
				kind: "created",
				agent: { agentId: parsed.data.agent.id as AgentRef["agentId"], runId: runId as AgentRef["runId"], url: parsed.data.agent.url as HttpsUrl },
			};
		},

		async getRun(agent) {
			let response: Response;
			try {
				response = await fetchImpl(runPath(agent), { method: "GET", headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
			} catch {
				return "unreachable";
			}
			if (!response.ok) return "unreachable";
			const parsed = runResponse.safeParse(await response.json().catch(() => null));
			if (!parsed.success) return "unreachable";
			const status = parsed.data.status.toUpperCase();
			const outcome = ENDED[status];
			if (!outcome) return { phase: "active", status };
			const pullRequests = (parsed.data.git?.branches ?? []).flatMap((branch) =>
				branch.prUrl?.startsWith("https://") ? [{ repoKey: repoKey(branch.repoUrl), url: branch.prUrl as HttpsUrl }] : [],
			);
			return { phase: "ended", outcome, pullRequests };
		},

		async cancelRun(agent) {
			let response: Response;
			try {
				response = await fetchImpl(`${runPath(agent)}/cancel`, { method: "POST", headers, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
			} catch {
				return "unreachable";
			}
			if (response.ok) return "requested";
			if (response.status === 409) return "notCancellable";
			return "unreachable";
		},
	};
}

const REASON_LIMIT = 300;

/** Cursor's error bodies come as { error }, { error: { message, code } }, { message }, or plain text; take the readable part. */
async function errorReason(response: Response): Promise<string> {
	const text = (await response.text().catch(() => "")).trim();
	if (!text) return "";
	let reason = text;
	try {
		reason = readReason(JSON.parse(text)) || text;
	} catch {
		// Not JSON: show the text as is.
	}
	const flat = reason.replace(/\s+/g, " ").trim();
	return flat.length > REASON_LIMIT ? `${flat.slice(0, REASON_LIMIT - 1)}…` : flat;
}

function readReason(value: unknown): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return "";
	const record = value as Record<string, unknown>;
	const message = readReason(record.message) || readReason(record.error) || readReason(record.detail);
	const code = typeof record.code === "string" ? record.code : "";
	if (message && code && !message.includes(code)) return `${message} (${code})`;
	return message || code;
}

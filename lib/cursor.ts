import { z } from "zod";
import {
	CREATE_TIMEOUT_MS,
	repoKey,
	type AgentRef,
	type AgentRequest,
	type HttpsUrl,
	type RunObservation,
} from "./domain";

export type CreateResult =
	| { kind: "created"; agent: AgentRef; cursorStatus: string }
	| { kind: "rejected"; message: string }
	| { kind: "unknown"; message: string };

export type CancelResult = "requested" | "notCancellable" | "unreachable";

export type CursorClient = {
	createAgent(request: AgentRequest): Promise<CreateResult>;
	getRun(agent: AgentRef): Promise<RunObservation | "unreachable">;
	cancelRun(agent: AgentRef): Promise<CancelResult>;
};

const createResponse = z.object({
	agent: z.object({
		id: z.string(),
		latestRunId: z.string(),
		url: z.string().url(),
		status: z.string(),
	}),
	run: z.object({
		id: z.string(),
		status: z.string(),
	}),
});

const runResponse = z.object({
	id: z.string(),
	agentId: z.string(),
	status: z.string(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	durationMs: z.number().optional(),
	result: z.unknown().optional(),
	git: z
		.object({
			branches: z.array(
				z.object({
					repoUrl: z.string(),
					branch: z.string().optional(),
					prUrl: z.string().url().optional(),
				}),
			),
		})
		.optional(),
});

const TERMINAL = {
	FINISHED: "finished",
	ERROR: "error",
	CANCELLED: "cancelled",
	EXPIRED: "expired",
} as const;

export function createCursorClient(options: {
	apiKey: string;
	fetch?: typeof fetch;
	baseUrl?: string;
}): CursorClient {
	const fetchImpl = options.fetch ?? fetch;
	const base = (options.baseUrl ?? "https://api.cursor.com").replace(/\/$/, "");
	const headers = {
		Authorization: `Bearer ${options.apiKey}`,
		"Content-Type": "application/json",
		Accept: "application/json",
	};

	return {
		async createAgent(request) {
			const body = {
				prompt: { text: request.promptText },
				repos: [{ url: request.repo.url, startingRef: request.repo.startingRef }],
				autoCreatePR: true,
			};
			let response: Response;
			try {
				response = await fetchImpl(`${base}/v1/agents`, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
				});
			} catch (error) {
				return { kind: "unknown", message: error instanceof Error ? error.message : "network" };
			}
			if (response.status >= 400 && response.status < 500) {
				const reason = await errorReason(response);
				return { kind: "rejected", message: `Cursor rejected the launch (${response.status})${reason ? `: ${reason}` : "."}` };
			}
			if (!response.ok) return { kind: "unknown", message: `Cursor returned ${response.status}.` };
			const parsed = createResponse.safeParse(await response.json().catch(() => null));
			if (!parsed.success) return { kind: "unknown", message: "Cursor returned an unreadable create response." };
			const runId = parsed.data.run.id || parsed.data.agent.latestRunId;
			return {
				kind: "created",
				cursorStatus: parsed.data.run.status,
				agent: {
					agentId: parsed.data.agent.id as AgentRef["agentId"],
					runId: runId as AgentRef["runId"],
					url: parsed.data.agent.url as HttpsUrl,
				},
			};
		},

		async getRun(agent) {
			let response: Response;
			try {
				response = await fetchImpl(`${base}/v1/agents/${agent.agentId}/runs/${agent.runId}`, {
					method: "GET",
					headers,
					signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
				});
			} catch {
				return "unreachable";
			}
			if (response.status === 404 || !response.ok) return "unreachable";
			const parsed = runResponse.safeParse(await response.json().catch(() => null));
			if (!parsed.success) return "unreachable";
			return toObservation(parsed.data);
		},

		async cancelRun(agent) {
			let response: Response;
			try {
				response = await fetchImpl(`${base}/v1/agents/${agent.agentId}/runs/${agent.runId}/cancel`, {
					method: "POST",
					headers,
					signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
				});
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

/**
 * Cursor's 4xx bodies are not pinned down by its docs, so take the most readable text out of the
 * common shapes ({ error }, { error: { message, code } }, { message }, { code }) or the raw text.
 */
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
	const message = readReason(record.message) || readReason(record.error) || readReason(record.detail) || readReason(record.details);
	const code = typeof record.code === "string" ? record.code : "";
	if (message && code && !message.includes(code)) return `${message} (${code})`;
	return message || code;
}

function toObservation(run: z.infer<typeof runResponse>): RunObservation {
	const outcome = TERMINAL[run.status as keyof typeof TERMINAL];
	const pullRequests = (run.git?.branches ?? []).flatMap((branch) => {
		if (!branch.prUrl) return [];
		return [{ repoKey: repoKey(branch.repoUrl), url: branch.prUrl as HttpsUrl }];
	});
	if (outcome) return { phase: "terminal", outcome, pullRequests };
	return { phase: "active", cursorStatus: run.status };
}

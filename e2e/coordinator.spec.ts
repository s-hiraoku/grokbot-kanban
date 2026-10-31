import { expect, test } from "@playwright/test";
import { BOT_TOKEN, cardTitled, columnOf, runStatus, signIn, tool, unique } from "./helpers";

async function rpc(request: import("@playwright/test").APIRequestContext, method: string, params: Record<string, unknown> = {}) {
	const response = await request.post("/api/mcp", {
		headers: { Authorization: `Bearer ${BOT_TOKEN}` },
		data: { jsonrpc: "2.0", id: 1, method, params },
	});
	expect(response.ok()).toBe(true);
	return (await response.json()).result;
}

test("the MCP server offers what the coordinating Bot's routine calls", async ({ request }) => {
	const init = await rpc(request, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
	expect(init.serverInfo.version).toBe("0.3.0");
	const { tools } = await rpc(request, "tools/list");
	const byName = new Map(tools.map((item: { name: string }) => [item.name, item]));
	for (const name of ["list_run_requests", "pass_run", "start_run", "finish_run"]) expect(byName.has(name), name).toBe(true);
	expect(Object.keys((byName.get("list_run_requests") as { inputSchema: { properties: object } }).inputSchema.properties)).toContain("everyone");
});

test("a run for another Bot reaches Running and In Review after reload", async ({ page, request }) => {
	const title = `coordinated ${unique()}`;
	const created = await tool(request, "create_card", { bot: "Director", title, assignees: ["Director"] });
	await signIn(page);
	await cardTitled(page, title).getByRole("button", { name: "Run", exact: true }).click();
	await expect(runStatus(page, title)).toHaveText("Run requested");

	// The coordinator's routine: everyone's requests, then pass Director's on.
	const own = await tool(request, "list_run_requests", { bot: "Kanban" });
	expect(own.cards.map((card: { id: string }) => card.id)).not.toContain(created.card.id);
	const all = await tool(request, "list_run_requests", { bot: "Kanban", everyone: true });
	const queued = all.cards.find((card: { id: string }) => card.id === created.card.id);
	expect(queued.run).toMatchObject({ bot: "Director", status: "requested", passedOnBy: null });
	await tool(request, "pass_run", { bot: "Kanban", card: created.card.id, note: "Sent with SendToAgent" });
	const again = await tool(request, "list_run_requests", { bot: "Kanban", everyone: true });
	expect(again.cards.find((card: { id: string }) => card.id === created.card.id).run.passedOnBy).toBe("Kanban");

	await tool(request, "start_run", { bot: "Director", card: created.card.id });
	await page.reload();
	await expect(runStatus(page, title)).toHaveText("Running");
	await tool(request, "finish_run", { bot: "Director", card: created.card.id, outcome: "review", summary: "Done, see notes" });
	await page.reload();
	await expect(columnOf(page, title)).toHaveAttribute("aria-label", /In Review/);
	await expect(runStatus(page, title)).toHaveCount(0);
	const after = await tool(request, "list_run_requests", { bot: "Kanban", everyone: true });
	expect(after.cards.map((card: { id: string }) => card.id)).not.toContain(created.card.id);
});

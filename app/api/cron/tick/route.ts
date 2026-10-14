import { json, requireCron } from "@/lib/http";
import { env, getBoard } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
	const config = env();
	const cron = requireCron(req, config);
	if (cron instanceof Response) return cron;
	const report = await getBoard().cron(cron).sync();
	return json(report);
}

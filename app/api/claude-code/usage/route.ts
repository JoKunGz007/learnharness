/**
 * GET /api/claude-code/usage — Fork: latest Claude plan-usage reading
 * (5-hour and weekly windows) from the CLI's rate_limit_event; null until a
 * turn has reported one this run of the app.
 */
import { claudeCodePlanUsage } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(claudeCodePlanUsage(), { headers: { "Cache-Control": "no-store" } });
}

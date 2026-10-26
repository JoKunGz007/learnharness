/**
 * GET /api/connections/local/usage — latest Claude plan-usage reading
 * (5-hour and weekly windows) from the CLI's rate_limit_event; null until a
 * turn has reported one this run of the app.
 */
import { localAgentPlanUsage } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(localAgentPlanUsage());
}

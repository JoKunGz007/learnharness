import { inspectClaudeInstallation } from "../agent/claude-code/installation.ts";
import { getClaudeBinary } from "../agent/claude-code/binary.ts"; // Fork
import { inspectClaudeAuth } from "../agent/claude-code/auth-status.ts"; // Fork
import { planUsage } from "../agent/claude-code/plan-usage.ts"; // Fork
import { initAuthEnv } from "./keys.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import { claudeCodeEnabled } from "./claude-code-config.ts";

/** The Settings status seam: initialize provenance before any child env is copied. */
export async function claudeCodeInstallationStatus() {
	initAuthEnv();
	const status = await inspectClaudeInstallation();
	// Fork: signed-in account/plan. Settings status path only, never turn launch.
	const binary = status.state === "not-found" ? null : getClaudeBinary();
	return binary ? { ...status, auth: await inspectClaudeAuth(binary) } : status;
}

/** Fork: latest plan-usage reading (null until a turn reports one), keyed by provider like the badge expects. */
export function claudeCodePlanUsage() { return { "claude-code": planUsage("claude-code") }; }

/** Same-origin browser intent, not user authentication. No CORS grants.
 * A public/shared server still requires its own access-control boundary. */
export async function claudeCodeInstallationResponse(
	request: Request,
	inspect = claudeCodeInstallationStatus,
	enabled = claudeCodeEnabled,
): Promise<Response> {
	const origin = subscriptionRequestOrigin(request);
	const supplied = request.headers.get("origin");
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	if (request.method !== "GET" || !origin
		|| request.headers.get("x-learnharness-claude-code") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site"
		|| (supplied !== null && supplied !== origin)) {
		return Response.json({ error: "Claude Code checks require a same-origin LearnHarness request." }, { status: 403, headers });
	}
	if (!enabled()) return Response.json({ error: "Claude Code is disabled." }, { status: 403, headers });
	return Response.json(await inspect(), { headers });
}

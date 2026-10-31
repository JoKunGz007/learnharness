// Fork: signed-in account and plan for the Settings status line, from `claude auth status --json`.
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import type { ClaudeCodeAuth } from "../../core/contracts/claude-code.ts";
import { claudeChildEnv } from "./env.ts";

export type ReadClaudeAuth = (binary: string) => Promise<string>;

/** No shell or model call. Settings status path only; never run during turn launch. */
export const readClaudeAuthStatus: ReadClaudeAuth = (binary) => new Promise((resolve, reject) => {
	execFile(binary, ["auth", "status", "--json"], {
		cwd: tmpdir(), env: claudeChildEnv(), windowsHide: true,
		timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
	}, (error, stdout) => error && !stdout ? reject(error) : resolve(String(stdout)));
});

const titleCase = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Never throws. A slow or failed check must not read as "signed out". */
export function parseClaudeAuth(stdout: string): ClaudeCodeAuth {
	let auth: { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown; email?: unknown } = {};
	try { const parsed: unknown = JSON.parse(stdout); if (parsed && typeof parsed === "object") auth = parsed; } catch { /* signed-out or failed runs may print no JSON */ }
	if (typeof auth.loggedIn !== "boolean") return { state: "uncertain" };
	if (!auth.loggedIn) return { state: "signed-out" };
	return {
		state: "signed-in",
		...(typeof auth.email === "string" && auth.email ? { account: auth.email } : {}),
		...(typeof auth.subscriptionType === "string" && auth.subscriptionType ? { plan: titleCase(auth.subscriptionType) } : {}),
		usesSubscription: /claude\.ai|oauth|subscription/i.test(typeof auth.authMethod === "string" ? auth.authMethod : ""),
	};
}

export async function inspectClaudeAuth(binary: string, read: ReadClaudeAuth = readClaudeAuthStatus): Promise<ClaudeCodeAuth> {
	try { return parseClaudeAuth(await read(binary)); } catch { return { state: "uncertain" }; }
}

// Fork: the Claude Code child env scrub (D-009).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeChildEnv } from "../src/agent/claude-code/env.ts";

describe("Fork: claudeChildEnv", () => {
	it("scrubs auth reroutes whatever the name's case (Windows env names are case-insensitive)", () => {
		const env = claudeChildEnv({ anthropic_api_key: "a", Anthropic_Base_Url: "b", ANTHROPIC_AUTH_TOKEN: "c", claude_code_use_bedrock: "1", PATH: "p" } as unknown as NodeJS.ProcessEnv);
		assert.deepEqual(Object.keys(env).filter((k) => /anthropic|bedrock/i.test(k)), []);
		assert.equal(env.PATH, "p", "other variables stay");
	});
});

describe("Fork: the shared Claude Code workspace folder", () => {
	it("refuses, on POSIX, a folder another user owns; skips the check on Windows", async () => {
		const { mkdtemp, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { assertOwnWorkspace } = await import("../src/agent/claude-code/stream.ts");
		const dir = await mkdtemp(join(tmpdir(), "lh-workspace-test-"));
		try {
			await assert.rejects(assertOwnWorkspace(dir, "linux", 424242), /not a private folder owned by this user/);
			await assertOwnWorkspace(dir, "win32", 424242);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

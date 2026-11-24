/** Fork: the welcome-back check (core/welcome-back.ts) — pure decision, splice, projection, settings. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newUserMessage, toLlmMessages, type LhMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { welcomeBackGapMs, withWelcomeBack, newWelcomeBackMessage, formatAway, WELCOME_BACK_GAP_MS } from "../src/core/welcome-back.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { parseCompactionSettingsBody } from "../src/server/settings-body.ts";

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const asst = (t: number) => ({ id: "a", role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: t }) as unknown as LhMessage;
const user = (t: number) => ({ ...newUserMessage("q"), timestamp: t }) as LhMessage;
const rec = (messages: LhMessage[], kind = "teach") => ({ kind, messages });

describe("welcomeBackGapMs", () => {
	it("fires at >= 6 h", () => {
		assert.equal(welcomeBackGapMs(rec([user(NOW - 6 * H), asst(NOW - 6 * H)]), NOW), 6 * H);
		assert.equal(welcomeBackGapMs(rec([user(NOW - 9 * H), asst(NOW - 9 * H)]), NOW), 9 * H);
	});
	it("not under 6 h", () => assert.equal(welcomeBackGapMs(rec([user(NOW - 6 * H + 1), asst(NOW - 6 * H + 1)]), NOW), null));
	it("not for practice", () => assert.equal(welcomeBackGapMs(rec([user(NOW - 9 * H), asst(NOW - 9 * H)], "practice"), NOW), null));
	it("not without an assistant reply", () => assert.equal(welcomeBackGapMs(rec([user(NOW - 9 * H)]), NOW), null));
	it("not when disabled", () => assert.equal(welcomeBackGapMs(rec([user(NOW - 9 * H), asst(NOW - 9 * H)]), NOW, false), null));
	it("compaction and side markers do not reset the gap", () => {
		const compaction = { id: "c", role: "custom", customType: "compaction", content: "", display: true, details: {}, timestamp: NOW - 1000 } as unknown as LhMessage;
		assert.equal(welcomeBackGapMs(rec([user(NOW - 9 * H), asst(NOW - 9 * H), compaction]), NOW), 9 * H);
	});
});

describe("withWelcomeBack", () => {
	const old = rec([user(NOW - 9 * H), asst(NOW - 9 * H)]);
	it("text: marker lands just before the learner message", () => {
		const input = user(NOW);
		const out = withWelcomeBack(old, "text", [input], NOW, true);
		assert.equal(out.length, 2);
		assert.equal((out[0] as { customType?: string }).customType, "welcome-back");
		assert.equal(out[1], input);
	});
	it("answer: marker follows the tool result (adjacency)", () => {
		const result = { id: "r", role: "toolResult", toolCallId: "t", toolName: "quiz", content: [], isError: false, timestamp: NOW } as unknown as LhMessage;
		const out = withWelcomeBack(old, "answer", [result], NOW, true);
		assert.equal(out[0], result);
		assert.equal((out[1] as { customType?: string }).customType, "welcome-back");
	});
	it("not on retry/continue/steers, nor when disabled or recent", () => {
		for (const t of ["retry", "continue", "steers", "retry-question"]) {
			const a = [user(NOW)];
			assert.equal(withWelcomeBack(old, t, a, NOW, true), a);
		}
		const a = [user(NOW)];
		assert.equal(withWelcomeBack(old, "text", a, NOW, false), a);
		assert.equal(withWelcomeBack(rec([user(NOW - H), asst(NOW - H)]), "text", a, NOW, true), a);
	});
});

describe("marker text, projection, settings", () => {
	it("wording and units", () => {
		assert.equal(formatAway(9 * H), "9 h");
		assert.equal(formatAway(47 * H), "47 h");
		assert.equal(formatAway(72 * H), "3 d");
		const m = newWelcomeBackMessage(9 * H, NOW - 9 * H);
		assert.match(m.content, /^\[Welcome-back check\] .*about 9 hours away/);
		assert.match(newWelcomeBackMessage(72 * H, 0).content, /about 3 days away/);
		assert.equal(WELCOME_BACK_GAP_MS, 6 * H);
	});
	it("reaches the model as user text and projects to a quiet part", () => {
		const m = newWelcomeBackMessage(9 * H, NOW - 9 * H);
		const llm = toLlmMessages([m] as never);
		assert.equal(llm[0]!.role, "user");
		const view = projectView([m] as never);
		assert.equal((view[0]!.parts[0] as { type: string }).type, "data-welcome-back");
	});
	it("setting defaults ON, sanitizes and validates", () => {
		assert.equal(resolveSettings(null).compaction.welcomeBack, true);
		assert.equal(resolveSettings({ version: 1, compaction: { welcomeBack: false } }).compaction.welcomeBack, false);
		assert.equal(sanitizeUserSettings({ version: 1, compaction: { welcomeBack: false } })!.compaction!.welcomeBack, false);
		assert.deepEqual(sanitizeUserSettings({ version: 1, compaction: { welcomeBack: "x" } })!.compaction, {});
		assert.equal(parseCompactionSettingsBody({ welcomeBack: "x" }).ok, false);
		assert.deepEqual(parseCompactionSettingsBody({ welcomeBack: false }), { ok: true, settings: { welcomeBack: false } });
	});
});

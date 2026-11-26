/**
 * Fork (D-024 review): the recall card's "Skipped" label shows only once a newer
 * clean propose_grade call has replaced the card. A brand-new card whose message
 * isn't in the record yet (not live) keeps the disabled key row.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatActionsContext } from "../components/chat.tsx";
import { RecallGradeCard, showSkipped } from "../components/recall-card.tsx";
import { RECALL_GRADE_TOOL, type LhMessage } from "../src/core/native-messages.ts";
import { call } from "./review-fixtures.ts";

const T0 = Date.UTC(2026, 0, 1);
const propose = (id: string, at: number): LhMessage[] => call(RECALL_GRADE_TOOL, id, { nodeId: "n_a", rating: "good" }, at, false);

function render(toolCallId: string, messages: LhMessage[]): string {
	const part = { type: `tool-${RECALL_GRADE_TOOL}`, toolCallId, state: "output-available", input: { nodeId: "n_a", rating: "good" } } as never;
	return renderToStaticMarkup(
		<ChatActionsContext.Provider value={{ chatId: "c1", syncFromServer: async () => {}, sendText: () => {}, openSetup: () => {}, recall: { messages: messages as never, busy: false, continueTurn: async () => {} } }}>
			<RecallGradeCard part={part} />
		</ChatActionsContext.Provider>,
	);
}

describe("RecallGradeCard — Skipped only when replaced", () => {
	it("showSkipped needs a different latest clean call", () => {
		assert.equal(showSkipped(false, false, "g2", "g1"), true);
		assert.equal(showSkipped(false, false, "g1", "g1"), false, "the latest call is never skipped");
		assert.equal(showSkipped(false, false, null, "g1"), false, "no clean call known yet");
		assert.equal(showSkipped(true, false, "g2", "g1"), false);
		assert.equal(showSkipped(false, true, "g2", "g1"), false);
	});
	it("a card not yet in the record (not live) keeps the key row, no Skipped", () => {
		const html = render("g1", []);
		assert.ok(!html.includes('data-testid="recall-skipped"'));
		assert.ok(html.includes('data-testid="recall-key-good"'));
		assert.ok(html.includes('data-live="false"'));
	});
	it("a card replaced by a newer clean call reads Skipped", () => {
		const html = render("g1", [...propose("g1", T0), ...propose("g2", T0 + 10)]);
		assert.ok(html.includes('data-testid="recall-skipped"'));
		assert.ok(!html.includes('data-testid="recall-key-good"'));
	});
	it("the latest un-keyed card is live with keys", () => {
		const html = render("g2", [...propose("g1", T0), ...propose("g2", T0 + 10)]);
		assert.ok(html.includes('data-live="true"'));
		assert.ok(!html.includes('data-testid="recall-skipped"'));
	});
});

/**
 * Fork (#806 E2, D-023): the recall UI's pure helpers (src/core/recall-view.ts)
 * and the card's hint wording: key handling, the live ("latest unanswered")
 * card, progress, the closing summary, next-due and the dispute chip's data.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { newGraphContextMessage, newRecallGradeMessage, RECALL_GRADE_TOOL, type GraphContextPick, type LhMessage, type RecallKey } from "../src/core/native-messages.ts";
import { allGraded, latestDispute, latestUnansweredCardId, nextDueAt, recallKeyAction, recallProgress, recallSummary, savedGradesOf, scheduledGrade } from "../src/core/recall-view.ts";
import { call } from "./review-fixtures.ts";

const T0 = Date.UTC(2026, 0, 1);
const PICKS: GraphContextPick[] = [
	{ id: "n_a", name: "A", statement: "sa", verification: "verified" },
	{ id: "n_b", name: "B", statement: "sb", verification: "none" },
	{ id: "n_c", name: "C", statement: "sc", verification: "corrected" },
];
const ctxMsg = () => ({ ...newGraphContextMessage(PICKS, []), timestamp: T0 }) as LhMessage;
const propose = (id: string, nodeId: string, rating: string | undefined, at: number): LhMessage[] =>
	call(RECALL_GRADE_TOOL, id, { nodeId, ...(rating ? { rating } : {}) }, at, false);
const keyed = (toolCallId: string, nodeId: string, key: RecallKey, at: number, tutorRating?: "again" | "hard" | "good"): LhMessage =>
	({ ...newRecallGradeMessage({ toolCallId, nodeId, key, ...(tutorRating ? { tutorRating } : {}) }), timestamp: at }) as LhMessage;

const noCtx = { inTextField: false, onButton: false, disabled: false };

describe("recallKeyAction", () => {
	it("maps 1/2/3/D and Enter", () => {
		assert.equal(recallKeyAction({ key: "1" }, noCtx), "again");
		assert.equal(recallKeyAction({ key: "2" }, noCtx), "hard");
		assert.equal(recallKeyAction({ key: "3" }, noCtx), "good");
		assert.equal(recallKeyAction({ key: "d" }, noCtx), "dispute");
		assert.equal(recallKeyAction({ key: "D" }, noCtx), "dispute");
		assert.equal(recallKeyAction({ key: "Enter" }, { ...noCtx, suggested: "hard" }), "accept");
	});
	it("Enter does nothing without a suggestion or on a focused button", () => {
		assert.equal(recallKeyAction({ key: "Enter" }, noCtx), null);
		assert.equal(recallKeyAction({ key: "Enter" }, { ...noCtx, suggested: "good", onButton: true }), null);
		assert.equal(recallKeyAction({ key: "1" }, { ...noCtx, onButton: true }), "again");
	});
	it("ignores text fields, modifiers, repeats, a disabled card and other keys", () => {
		assert.equal(recallKeyAction({ key: "1" }, { ...noCtx, inTextField: true }), null);
		assert.equal(recallKeyAction({ key: "1", ctrlKey: true }, noCtx), null);
		assert.equal(recallKeyAction({ key: "1", metaKey: true }, noCtx), null);
		assert.equal(recallKeyAction({ key: "1", repeat: true }, noCtx), null);
		assert.equal(recallKeyAction({ key: "1" }, { ...noCtx, disabled: true }), null);
		assert.equal(recallKeyAction({ key: "4" }, noCtx), null);
	});
});

describe("scheduledGrade", () => {
	it("is the lower of tutor and key; dispute counts nothing", () => {
		assert.equal(scheduledGrade("good", "hard"), "hard");
		assert.equal(scheduledGrade("hard", "good"), "hard");
		assert.equal(scheduledGrade(undefined, "good"), "good");
		assert.equal(scheduledGrade("good", "dispute"), null);
	});
});

describe("latest unanswered card, progress and summary", () => {
	const q1 = propose("g1", "n_a", "good", T0 + 1000);
	const q2 = propose("g2", "n_b", undefined, T0 + 3000);
	const q3 = propose("g3", "n_c", "hard", T0 + 5000);

	it("the live card is the newest propose_grade call without a saved key", () => {
		assert.equal(latestUnansweredCardId([ctxMsg(), ...q1]), "g1");
		assert.equal(latestUnansweredCardId([ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000, "good")]), null);
		assert.equal(latestUnansweredCardId([ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000, "good"), ...q2]), "g2");
		assert.equal(latestUnansweredCardId([ctxMsg()]), null);
	});

	it("reads saved keys by call id", () => {
		const g = savedGradesOf([ctxMsg(), ...q1, keyed("g1", "n_a", "dispute", T0 + 2000, "good")]);
		assert.equal(g.get("g1")?.key, "dispute");
		assert.equal(g.get("g1")?.tutorRating, "good");
	});

	it("progress counts statements with a saved key (n of m), capped at m", () => {
		assert.deepEqual(recallProgress([ctxMsg()]), { current: 1, total: 3, done: 0 });
		assert.deepEqual(recallProgress([ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000)]), { current: 2, total: 3, done: 1 });
		const all = [ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000), ...q2, keyed("g2", "n_b", "dispute", T0 + 4000), ...q3, keyed("g3", "n_c", "hard", T0 + 6000, "hard")];
		assert.deepEqual(recallProgress(all), { current: 3, total: 3, done: 3 });
	});

	it("allGraded counts a just-saved node before the record has it", () => {
		const two = [ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000), ...q2, keyed("g2", "n_b", "good", T0 + 4000), ...q3];
		assert.equal(allGraded(two), false);
		assert.equal(allGraded(two, "n_c"), true);
		assert.equal(allGraded([]), false);
	});

	it("summary: counts per scheduled grade, disputes, completeness", () => {
		const all = [ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000, "hard"), ...q2, keyed("g2", "n_b", "dispute", T0 + 4000), ...q3, keyed("g3", "n_c", "again", T0 + 6000, "hard")];
		const s = recallSummary(all);
		assert.deepEqual({ again: s.again, hard: s.hard, good: s.good, disputed: s.disputed, total: s.total, complete: s.complete }, { again: 1, hard: 1, good: 0, disputed: 1, total: 3, complete: true });
		assert.deepEqual(s.gradedNodeIds.sort(), ["n_a", "n_c"]);
		assert.equal(recallSummary([ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000)]).complete, false);
	});

	it("summary: counts a just-saved key not yet in the record, once", () => {
		const before = [ctxMsg(), ...q1, keyed("g1", "n_a", "good", T0 + 2000), ...q2, keyed("g2", "n_b", "hard", T0 + 4000), ...q3];
		const pending = { toolCallId: "g3", nodeId: "n_c", key: "good" as const, tutorRating: "hard" as const, at: T0 + 6000 };
		const s = recallSummary(before, pending);
		assert.deepEqual({ again: s.again, hard: s.hard, good: s.good, complete: s.complete }, { again: 0, hard: 2, good: 1, complete: true });
		const after = [...before, keyed("g3", "n_c", "good", T0 + 6000, "hard")];
		assert.deepEqual(recallSummary(after, pending), recallSummary(after));
	});
});

describe("nextDueAt and latestDispute", () => {
	const item = (id: string, dueAt: number) => ({ id, dueAt }) as never;
	it("takes the soonest dueAt among the given nodes", () => {
		const payload = { due: [item("n_a", 50)], upcoming: [item("n_b", 20), item("n_c", 90)] };
		assert.equal(nextDueAt(payload, ["n_b", "n_c"]), 20);
		assert.equal(nextDueAt(payload, ["n_a", "n_c"]), 50);
		assert.equal(nextDueAt(payload, []), null);
		assert.equal(nextDueAt(payload, ["n_zzz"]), null);
		assert.equal(nextDueAt(null, ["n_a"]), null);
	});
	it("picks the newest dispute", () => {
		assert.equal(latestDispute(undefined), undefined);
		assert.equal(latestDispute([{ nodeId: "n", chatId: "c", at: 5, reason: "old" }, { nodeId: "n", chatId: "c", at: 9, reason: "new" }])?.reason, "new");
	});
});

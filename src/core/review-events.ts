/**
 * REVIEW EVENTS (review plan, docs/review-plan.md §4.1 — option A): the
 * retrieval evidence the scheduler folds, DERIVED from practice-session
 * records and never stored. One event per target proposition of every
 * cleanly-concluded problem; the order and timestamps are the record's.
 *
 * What counts as evidence: `solved`, `solvedWithHints` and `surrendered`.
 * `movedOn` (the learner ended the problem — no proof of retrieval either
 * way) and `dismissed` (system-synthesized) produce NOTHING (owner,
 * 2026-10-23). Untagged problems (no `target`) carry no node-level signal.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	RECALL_GRADE_TOOL,
	cleanToolCallIds,
	type LhMessage,
	type LhMarkerMessage,
	type RecallGradeDetails,
	type RecallRating,
} from "./native-messages.ts";

/** The conclude outcomes that are retrieval evidence. */
export type ReviewOutcome = "solved" | "solvedWithHints" | "surrendered";

/** The hint-ladder rung a problem needed (0–5), or null = no hint given. */
export type ReviewRung = 0 | 1 | 2 | 3 | 4 | 5 | null;

/** The agent's classification of a miss (conclude's `missClass`): the first
 *  three are failures of memory, the last two are slips on knowledge the
 *  learner held (docs/review-plan.md §12). */
export type ReviewMissClass = "cue" | "discrimination" | "structural" | "execution" | "careless";

/** One retrieval of one proposition (a concluded practice problem). */
export interface PracticeReviewEvent {
	/** Graph proposition id (canonical — normalized at pose time). */
	nodeId: string;
	/** Epoch ms of the conclude call. */
	at: number;
	outcome: ReviewOutcome;
	rung: ReviewRung;
	/** null = no miss recorded (or an unrecognized value). */
	missClass: ReviewMissClass | null;
	/** The practice chat the event came from — review rules treat events of
	 *  one session as one sitting (docs/review-plan.md §13). */
	session: string;
}

/** Fork (#806 E): the FSRS grade of a recall event — ts-fsrs Rating values
 *  (Again 1 < Hard 2 < Good 3), kept numeric so this file stays ts-fsrs-free. */
export type RecallEffective = 1 | 2 | 3;

/** Fork (#806 E): one graded recall statement. `at` is the learner's key
 *  press; `effective` is the lower of the tutor's rating and the learner's
 *  key, or the key alone when the tutor gave no rating (self-rate). */
export interface RecallReviewEvent {
	kind: "recall";
	nodeId: string;
	at: number;
	session: string;
	effective: RecallEffective;
}

/** What the scheduler folds: practice conclude events and recall grades. */
export type ReviewEvent = PracticeReviewEvent | RecallReviewEvent;

/** Fork (#806 E): a disputed recall grade — no event, surfaced as a flag. */
export interface ReviewDispute {
	nodeId: string;
	chatId: string;
	at: number;
	reason?: string;
}

const EVIDENCE_OUTCOMES:ReadonlySet<string> = new Set(["solved", "solvedWithHints", "surrendered"]);
const MISS_CLASSES: ReadonlySet<string> = new Set(["cue", "discrimination", "structural", "execution", "careless"]);

/** A recognized miss class, else null. */
function parseMissClass(raw: unknown): ReviewMissClass | null {
	return typeof raw === "string" && MISS_CLASSES.has(raw) ? (raw as ReviewMissClass) : null;
}

/** "R0".."R5" → 0..5; anything else (null, absent, malformed) → null. */
function parseRung(raw: unknown): ReviewRung {
	if (typeof raw !== "string") return null;
	const match = /^R([0-5])$/.exec(raw);
	return match ? (Number(match[1]) as ReviewRung) : null;
}

/** The pose's target ids: strings only, deduplicated; [] = untagged. */
function targetIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return [...new Set(raw.filter((t): t is string => typeof t === "string" && t.length > 0))];
}

/**
 * Fold one practice session's messages into review events, in record order.
 * A conclude pairs with the NEWEST cleanly-posed problem before it (the
 * same pairing as `problemInputForConclude`); errored or dangling calls
 * never happened (the honest-activation ruling). `session` is the chat id
 * stamped onto every event.
 */
export function reviewEventsFromMessages(messages: readonly LhMessage[], session: string): PracticeReviewEvent[] {
	const clean = cleanToolCallIds(messages);
	const events: PracticeReviewEvent[] = [];
	let targets: string[] = [];
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		for (const block of assistant.content) {
			if (block.type !== "toolCall" || !clean.has(block.id)) continue;
			if (block.name === PRACTICE_PROBLEM_TOOL) {
				targets = targetIds(block.arguments?.target);
				continue;
			}
			if (block.name !== PRACTICE_CONCLUDE_TOOL) continue;
			const outcome = block.arguments?.outcome;
			if (typeof outcome === "string" && EVIDENCE_OUTCOMES.has(outcome)) {
				const rung = parseRung(block.arguments?.rung);
				const missClass = parseMissClass(block.arguments?.missClass);
				for (const nodeId of targets) {
					events.push({ nodeId, at: assistant.timestamp, outcome: outcome as ReviewOutcome, rung, missClass, session });
				}
			}
			targets = [];
		}
	}
	return events;
}

const RATING_VALUE: Record<RecallRating, RecallEffective> = { again: 1, hard: 2, good: 3 };

/**
 * Fork (#806 E): fold a RECALL chat's record into events + disputes. Only a
 * clean `propose_grade` call that the learner keyed (a "recall-grade" marker
 * naming its toolCallId, first marker wins) counts; the call is the authority
 * for nodeId and the tutor's rating. The effective grade is the lower of tutor
 * and key (the key alone when the tutor gave no rating). A dispute yields no
 * event, only a flag. `conclude` calls in a recall chat are never read.
 */
export function recallEventsFromMessages(
	messages: readonly LhMessage[],
	session: string,
): { events: RecallReviewEvent[]; disputes: ReviewDispute[] } {
	const clean = cleanToolCallIds(messages);
	const calls = new Map<string, { nodeId: string; tutor?: RecallRating }>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		for (const block of (m as AssistantMessage).content) {
			if (block.type !== "toolCall" || block.name !== RECALL_GRADE_TOOL || !clean.has(block.id)) continue;
			const nodeId = block.arguments?.nodeId;
			if (typeof nodeId !== "string" || nodeId.length === 0) continue;
			const rating = block.arguments?.rating;
			calls.set(block.id, { nodeId, ...(typeof rating === "string" && rating in RATING_VALUE ? { tutor: rating as RecallRating } : {}) });
		}
	}
	const events: RecallReviewEvent[] = [];
	const disputes: ReviewDispute[] = [];
	const seen = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as LhMarkerMessage;
		if (marker.customType !== "recall-grade") continue;
		const d = marker.details as Partial<RecallGradeDetails> | null;
		const call = typeof d?.toolCallId === "string" ? calls.get(d.toolCallId) : undefined;
		if (!d || !call || seen.has(d.toolCallId!)) continue;
		seen.add(d.toolCallId!);
		if (d.key === "dispute") {
			disputes.push({ nodeId: call.nodeId, chatId: session, at: marker.timestamp, ...(d.reason ? { reason: d.reason } : {}) });
			continue;
		}
		if (d.key !== "again" && d.key !== "hard" && d.key !== "good") continue;
		const key = RATING_VALUE[d.key];
		const effective = (call.tutor ? Math.min(RATING_VALUE[call.tutor], key) : key) as RecallEffective;
		events.push({ kind: "recall", nodeId: call.nodeId, at: marker.timestamp, session, effective });
	}
	return { events, disputes };
}

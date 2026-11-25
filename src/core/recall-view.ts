/**
 * Fork (#806 E2, D-023): the recall UI's pure helpers — saved grades read off
 * the record, which card is live, progress, the closing summary, key handling.
 * No React, no I/O; components/recall-card.tsx and the chat header call it.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { RECALL_GRADE_TOOL, cleanToolCallIds, type LhMarkerMessage, type LhMessage, type RecallKey, type RecallRating } from "./native-messages.ts";
import { recallPicksOf } from "./recall.ts";
import type { ReviewDispute } from "./review-events.ts";
import type { ReviewPayload } from "./review-payload.ts";

/** One saved key (a recall-grade marker, flattened). */
export interface SavedGrade {
	toolCallId: string;
	nodeId: string;
	key: RecallKey;
	tutorRating?: RecallRating;
	reason?: string;
	at: number;
}

const ORDER: Record<RecallRating, number> = { again: 0, hard: 1, good: 2 };

/** The saved keys, by `propose_grade` call id. */
export function savedGradesOf(messages: readonly LhMessage[]): Map<string, SavedGrade> {
	const out = new Map<string, SavedGrade>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "custom" || (m as LhMarkerMessage).customType !== "recall-grade") continue;
		const d = (m as LhMarkerMessage).details as Partial<SavedGrade> | null;
		if (!d || typeof d.toolCallId !== "string" || typeof d.nodeId !== "string" || typeof d.key !== "string") continue;
		out.set(d.toolCallId, { toolCallId: d.toolCallId, nodeId: d.nodeId, key: d.key, ...(d.tutorRating ? { tutorRating: d.tutorRating } : {}), ...(d.reason ? { reason: d.reason } : {}), at: (m as LhMarkerMessage).timestamp });
	}
	return out;
}

/** The newest clean `propose_grade` call id, or null. */
export function latestGradeCallId(messages: readonly LhMessage[]): string | null {
	const clean = cleanToolCallIds(messages);
	let latest: string | null = null;
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		for (const b of (m as AssistantMessage).content) if (b.type === "toolCall" && b.name === RECALL_GRADE_TOOL && clean.has(b.id)) latest = b.id;
	}
	return latest;
}

/** The card that takes keys: the newest propose_grade call, if it has no saved key. */
export function latestUnansweredCardId(messages: readonly LhMessage[]): string | null {
	const id = latestGradeCallId(messages);
	return id && !savedGradesOf(messages).has(id) ? id : null;
}

/** What the schedule uses: the lower of the tutor's pick and the learner's key; a dispute counts nothing. */
export function scheduledGrade(tutor: RecallRating | undefined, key: RecallKey): RecallRating | null {
	if (key === "dispute") return null;
	return tutor && ORDER[tutor] < ORDER[key] ? tutor : key;
}

/** The saved line on the card. Owner (2026-11-25): when the schedule counts a lower
 *  grade than the key (lower of two), show both: "Saved: Good · counted: Hard". */
export function recallSavedText(key: RecallKey, tutor: RecallRating | undefined): string {
	if (key === "dispute") return "Disputed";
	const cap = (r: RecallRating) => r[0]!.toUpperCase() + r.slice(1);
	const counted = scheduledGrade(tutor, key);
	return counted && counted !== key ? `Saved: ${cap(key)} · counted: ${cap(counted)}` : `Saved: ${cap(key)}`;
}

/** The latest key per statement (a retried statement keeps its last). */
function lastPerNode(messages: readonly LhMessage[], pending?: SavedGrade): Map<string, SavedGrade> {
	const byNode = new Map<string, SavedGrade>();
	for (const g of [...savedGradesOf(messages).values()].sort((a, b) => a.at - b.at)) byNode.set(g.nodeId, g);
	// A key saved this moment but not yet adopted from the record counts as the newest.
	if (pending && !savedGradesOf(messages).has(pending.toolCallId)) byNode.set(pending.nodeId, pending);
	return byNode;
}

/** "n of m due": the statement being worked on (1-based, capped at m) and the total. */
export function recallProgress(messages: readonly LhMessage[]): { current: number; total: number; done: number } {
	const total = recallPicksOf(messages).length;
	const done = Math.min(lastPerNode(messages).size, total);
	return { current: Math.min(done + 1, total), total, done };
}

/** True once every statement of the session holds a saved key (counting `extraNodeId` as saved). */
export function allGraded(messages: readonly LhMessage[], extraNodeId?: string): boolean {
	const total = recallPicksOf(messages).length;
	if (total === 0) return false;
	const ids = new Set(lastPerNode(messages).keys());
	if (extraNodeId) ids.add(extraNodeId);
	return ids.size >= total;
}

export interface RecallSummaryData { total: number; again: number; hard: number; good: number; disputed: number; complete: boolean; gradedNodeIds: string[] }

/** The closing card's numbers, from the saved keys: counts are of the SCHEDULED grade (lower of tutor and key). */
export function recallSummary(messages: readonly LhMessage[], pending?: SavedGrade): RecallSummaryData {
	const out: RecallSummaryData = { total: recallPicksOf(messages).length, again: 0, hard: 0, good: 0, disputed: 0, complete: false, gradedNodeIds: [] };
	for (const g of lastPerNode(messages, pending).values()) {
		const s = scheduledGrade(g.tutorRating, g.key);
		if (s === null) out.disputed++;
		else { out[s]++; out.gradedNodeIds.push(g.nodeId); }
	}
	out.complete = out.total > 0 && out.again + out.hard + out.good + out.disputed >= out.total;
	return out;
}

/** The soonest dueAt among the given nodes in the /review payload; null when none is listed. */
export function nextDueAt(payload: Pick<ReviewPayload, "due" | "upcoming"> | null, nodeIds: readonly string[]): number | null {
	if (!payload || nodeIds.length === 0) return null;
	const want = new Set(nodeIds);
	let best: number | null = null;
	for (const item of [...payload.due, ...payload.upcoming]) if (want.has(item.id) && (best === null || item.dueAt < best)) best = item.dueAt;
	return best;
}

/** The newest dispute (by time), or undefined. */
export function latestDispute(disputes: readonly ReviewDispute[] | undefined): ReviewDispute | undefined {
	return disputes?.reduce<ReviewDispute | undefined>((a, d) => (!a || d.at >= a.at ? d : a), undefined);
}

export type RecallKeyAction = RecallRating | "dispute" | "accept";

/** What a key press means for the live card; null = not ours. Keys are ignored with a
 *  modifier, inside a text field, when disabled; Enter also yields to a focused button
 *  (it would click it) and needs a tutor suggestion to accept. */
export function recallKeyAction(
	e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean },
	ctx: { inTextField: boolean; onButton: boolean; disabled: boolean; suggested?: RecallRating },
): RecallKeyAction | null {
	if (ctx.disabled || ctx.inTextField || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null;
	switch (e.key) {
		case "1": return "again";
		case "2": return "hard";
		case "3": return "good";
		case "d": case "D": return "dispute";
		case "Enter": return ctx.suggested && !ctx.onButton ? "accept" : null;
		default: return null;
	}
}

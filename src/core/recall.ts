/**
 * Fork (#806 E, D-023): the recall chat's shared rules — the picks a recall
 * session carries (the graph-context marker's propositions, stamped with their
 * verification status at creation), the `propose_grade` input check, and the
 * learner-grade route's input check. Pure; the tool and the route both call it.
 */

import { resolveTargetId } from "./chains.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	RECALL_GRADE_TOOL,
	cleanToolCallIds,
	type GraphContextPick,
	type LhMarkerMessage,
	type LhMessage,
	type RecallGradeDetails,
	type RecallKey,
	type RecallRating,
} from "./native-messages.ts";

/** Most statements one recall session carries (D-023, piece E). */
export const RECALL_PICK_CAP = 10;
/** Longest dispute reason kept (characters). */
export const RECALL_REASON_MAX = 500;

const RATINGS: readonly string[] = ["again", "hard", "good"];

/** The session's propositions, in the order given (the graph-context marker). */
export function recallPicksOf(messages: readonly LhMessage[]): GraphContextPick[] {
	for (const m of messages) {
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as LhMarkerMessage;
		if (marker.customType !== "graph-context") continue;
		const picks = (marker.details as { propositions?: unknown } | null)?.propositions;
		return Array.isArray(picks) ? (picks as GraphContextPick[]) : [];
	}
	return [];
}

/** Problems with a `propose_grade` input against the session's picks (empty = ok).
 *  A rating is only for verified/corrected statements; doubtful and unchecked
 *  ones are self-rated by the learner. */
export function proposeGradeProblems(picks: readonly GraphContextPick[], input: { nodeId?: unknown; rating?: unknown }): string[] {
	if (typeof input.nodeId !== "string") return ["nodeId must be one of the session's statement ids"];
	const id = resolveTargetId(input.nodeId, picks);
	const pick = id ? picks.find((p) => p.id === id) : undefined;
	if (!pick) return [`nodeId ${JSON.stringify(input.nodeId)} is not one of this session's statements — use an id from the session context`];
	if (input.rating === undefined || input.rating === null) return [];
	if (typeof input.rating !== "string" || !RATINGS.includes(input.rating)) return ["rating must be again, hard or good"];
	if (pick.verification !== "verified" && pick.verification !== "corrected") {
		return [`statement [${pick.id}] is ${pick.verification === "doubtful" ? "doubtful" : "unchecked"} — omit rating; the learner rates themselves`];
	}
	return [];
}

/** A parsed grade-route body, or the reason it is refused (HTTP 400). */
export function parseGradeBody(body: unknown): { toolCallId: string; key: RecallKey; reason?: string } | { error: string } {
	const b = (body ?? {}) as { toolCallId?: unknown; key?: unknown; reason?: unknown };
	if (typeof b.toolCallId !== "string" || b.toolCallId.length === 0) return { error: "toolCallId is required" };
	if (typeof b.key !== "string" || ![...RATINGS, "dispute"].includes(b.key)) return { error: "key must be again, hard, good or dispute" };
	const key = b.key as RecallKey;
	if (b.reason === undefined || b.reason === null) return { toolCallId: b.toolCallId, key };
	if (typeof b.reason !== "string") return { error: "reason must be a string" };
	if (key !== "dispute") return { error: "reason is only valid with key dispute" };
	const reason = b.reason.trim().slice(0, RECALL_REASON_MAX);
	return { toolCallId: b.toolCallId, key, ...(reason ? { reason } : {}) };
}

/** The saved `propose_grade` call a key refers to, or why it cannot be graded. */
export function gradeTarget(messages: readonly LhMessage[], toolCallId: string):
	| { ok: true; details: Omit<RecallGradeDetails, "key" | "reason"> }
	| { ok: false; status: 400 | 409; error: string } {
	const clean = cleanToolCallIds(messages);
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		for (const block of (m as AssistantMessage).content) {
			if (block.type !== "toolCall" || block.id !== toolCallId || block.name !== RECALL_GRADE_TOOL || !clean.has(block.id)) continue;
			const nodeId = block.arguments?.nodeId;
			if (typeof nodeId !== "string") continue;
			const alreadyGraded = messages.some((x) =>
				(x as { role?: string }).role === "custom" &&
				(x as LhMarkerMessage).customType === "recall-grade" &&
				((x as LhMarkerMessage).details as { toolCallId?: unknown } | null)?.toolCallId === toolCallId);
			if (alreadyGraded) return { ok: false, status: 409, error: "Already graded" };
			const rating = block.arguments?.rating;
			return { ok: true, details: { toolCallId, nodeId, ...(typeof rating === "string" && RATINGS.includes(rating) ? { tutorRating: rating as RecallRating } : {}) } };
		}
	}
	return { ok: false, status: 400, error: "toolCallId is not a propose_grade call in this chat" };
}

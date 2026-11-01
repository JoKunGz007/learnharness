import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeQuizType } from "../core/question-core.ts";
import { QUESTION_TOOLS } from "../core/pending.ts";
import { failedOutputCallIds, nativeInputCause, userFacingTextOf, type LhMessage } from "../core/native-messages.ts";

/**
 * The teacher's lesson-text rule (owner, 2026-11-01): once the plan exists, a
 * check `quiz` or an `ask_user_question` must not be posed in a beat where no
 * lesson text reached the learner. Seen live: a turn of thinking plus
 * `ask_user_question`, so the explanation was lost. `type: "predict"` is
 * exempt (it precedes the teaching). Refused ONCE per beat: the second
 * attempt passes, so a turn can never loop or hang.
 *
 * A beat starts at the latest learner-origin input: a user message, a
 * resolved learner answer, or a recovery click (nativeInputCause "learner").
 * A refusal is an error result, which is "neutral" there, so it does not
 * reset the beat; it is recognised by REFUSAL_MARKER instead.
 */

/** Opening words of every refusal; also how a retry finds the earlier one. */
export const LESSON_TEXT_REFUSAL_MARKER = "Not posed: no lesson text reached the learner this turn.";

export const LESSON_TEXT_REFUSAL =
	`${LESSON_TEXT_REFUSAL_MARKER} First deliver the explanation with send_to_user ` +
	"(or as plain text if send_to_user is not available), then call the question again.";

/** Does a question call need lesson text first? Checks and asks do; a prediction does not. */
function needsLessonText(toolName: string, args: unknown): boolean {
	if (toolName === "ask_user_question") return true;
	if (toolName !== "quiz") return false;
	return normalizeQuizType((args as { type?: unknown } | null)?.type) !== "predict";
}

function resultText(m: AgentMessage): string {
	const content = (m as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content.map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? (b as { text?: string }).text ?? "" : "")).join("");
}

export interface LessonTextGateInput {
	toolName: string;
	toolCallId: string;
	args: unknown;
	/** The agent context's messages so far (the current assistant message may be among them). */
	messages: readonly AgentMessage[];
	/** The assistant message holding this call. */
	assistantContent: ReadonlyArray<{ type: string; id?: string }>;
	/** Teacher only, and only once the session's plan exists. */
	enforce: boolean;
}

/** The refusal reason, or undefined to let the call through. Pure. */
export function lessonTextRefusal(input: LessonTextGateInput): string | undefined {
	if (!input.enforce || !needsLessonText(input.toolName, input.args)) return undefined;
	const { messages, toolCallId } = input;
	// The beat: everything after the latest learner-origin input.
	let start = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (nativeInputCause(messages[i]!, messages.slice(0, i)) === "learner") { start = i + 1; break; }
	}
	const beat = messages.slice(start);
	const refusedBefore = beat.some((m) =>
		m.role === "toolResult" && m.isError && (QUESTION_TOOLS as readonly string[]).includes(m.toolName) &&
		resultText(m).startsWith(LESSON_TEXT_REFUSAL_MARKER));
	if (refusedBefore) return undefined;
	const failed = failedOutputCallIds(messages as readonly LhMessage[]);
	const holdsThisCall = (m: AgentMessage) => m.role === "assistant" && m.content.some((b) => b.type === "toolCall" && b.id === toolCallId);
	const delivered = (content: unknown) => userFacingTextOf(content, failed).length > 0;
	for (const m of beat) {
		if (m.role === "assistant" && !holdsThisCall(m) && delivered(m.content)) return undefined;
	}
	// The current message: only blocks AHEAD of this call count.
	const at = input.assistantContent.findIndex((b) => b.type === "toolCall" && b.id === toolCallId);
	if (delivered(at < 0 ? input.assistantContent : input.assistantContent.slice(0, at))) return undefined;
	return LESSON_TEXT_REFUSAL;
}

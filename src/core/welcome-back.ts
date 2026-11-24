/**
 * Fork: the welcome-back check. A Teach chat idle for 6 h+ gets a
 * model-facing marker just before the learner's next input, steering the
 * tutor to open with 2-3 recall questions (skippable). Pure helpers here;
 * the chat handler decides when to call them.
 */
import { isSideQuestionMarker, newMessageId, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

/** Fixed 6 h threshold (not configurable). */
export const WELCOME_BACK_GAP_MS = 6 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The inputs that count as "the learner's first input back". */
export function isWelcomeBackInput(type: string): boolean {
	return type === "text" || type === "answer";
}

/** "9 h" / "3 d" (days from 48 h). */
export function formatAway(gapMs: number): string {
	const hours = Math.round(gapMs / HOUR_MS);
	return hours >= 48 ? `${Math.round(gapMs / (24 * HOUR_MS))} d` : `${hours} h`;
}

/** The gap since the newest message (ms), or null when the check must not
 *  fire: practice chats, disabled, no assistant reply yet, or under 6 h.
 *  Side-question and compaction markers don't count as activity (compaction
 *  appends at the tail right before this check runs). */
export function welcomeBackGapMs(
	record: { kind?: string; messages: readonly LhMessage[] },
	now: number,
	enabled = true,
): number | null {
	if (!enabled || record.kind === "practice") return null;
	let newest = 0;
	let replied = false;
	for (const m of record.messages) {
		if (m.role === "assistant") replied = true;
		if (isSideQuestionMarker(m)) continue;
		if (m.role === "custom" && m.customType === "compaction") continue;
		const t = (m as { timestamp?: unknown }).timestamp;
		if (typeof t === "number" && Number.isFinite(t) && t > newest) newest = t;
	}
	if (!replied || newest <= 0) return null;
	const gap = now - newest;
	return gap >= WELCOME_BACK_GAP_MS ? gap : null;
}

/** The marker. `content` is model-facing; the transcript shows only a quiet
 *  line built from `details`. */
export function newWelcomeBackMessage(gapMs: number, lastAt: number): LhMarkerMessage {
	const away = formatAway(gapMs);
	const when = new Date(lastAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
	return {
		id: newMessageId(),
		role: "custom",
		customType: "welcome-back",
		content:
			`[Welcome-back check] The learner is returning after about ${away.replace(/ h$/, " hours").replace(/ d$/, " days")} away (last turn: ${when}). ` +
			"Before continuing, open with 2–3 short recall questions on what was covered just before the break, using the question tools, " +
			"and tell them they can answer \"skip\" to carry on. If they skip, continue where the session left off. " +
			"If an answer shows they've forgotten something, re-teach it briefly before moving on. " +
			"If their message asks for something specific, handle that first.",
		display: true,
		details: { gapMs, lastAt },
		timestamp: Date.now(),
	};
}

/**
 * Splice the marker into an input's appends. A text message: just before the
 * learner's message (the last append). A question answer: AFTER the tool
 * result (a user-role marker between a tool call and its result would break
 * provider adjacency). Returns the appends unchanged when the check doesn't fire.
 */
export function withWelcomeBack(
	record: { kind?: string; messages: readonly LhMessage[] },
	inputType: string,
	appends: LhMessage[],
	now: number,
	enabled: boolean,
): LhMessage[] {
	if (!isWelcomeBackInput(inputType) || appends.length === 0) return appends;
	const gap = welcomeBackGapMs(record, now, enabled);
	if (gap === null) return appends;
	const marker = newWelcomeBackMessage(gap, now - gap);
	return inputType === "answer" ? [...appends, marker] : [...appends.slice(0, -1), marker, appends[appends.length - 1]!];
}

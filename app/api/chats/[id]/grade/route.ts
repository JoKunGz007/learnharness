/**
 * Fork (#806 E, D-023): THE SILENT RECALL-GRADE ROUTE. The learner's key for
 * one `propose_grade` call is appended to the recall chat's record as a
 * "recall-grade" marker and wakes NOTHING — no turn, no model call (the
 * dismiss route's style). The app asks for the next question afterwards.
 *
 * 404 unknown chat; 400 not a recall chat / bad body / the toolCallId is not
 * a clean propose_grade call here; 409 already graded, or a turn is running
 * (the turn's persist would overwrite this append — retry once it settles).
 * A dispute reason is trimmed and cut at RECALL_REASON_MAX characters.
 */
import { emit, gradeTarget, newRecallGradeMessage, parseGradeBody } from "@/src/core";
import { getChat, isTurnRunning, stores } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });
	if (chat.kind !== "practice" || chat.variant !== "recall") return Response.json({ error: "Not a recall chat" }, { status: 400 });
	const body = parseGradeBody(await req.json().catch(() => null));
	if ("error" in body) return Response.json({ error: body.error }, { status: 400 });
	if (isTurnRunning(id)) return Response.json({ error: "A turn is running" }, { status: 409 });
	const target = gradeTarget(chat.messages, body.toolCallId);
	if (!target.ok) return Response.json({ error: target.error }, { status: target.status });
	const marker = newRecallGradeMessage({ ...target.details, key: body.key, ...(body.reason ? { reason: body.reason } : {}) });
	stores.chatStore.saveMessages(id, [...chat.messages, marker]);
	emit("record-changed", { chatId: id });
	return Response.json({ ok: true, at: marker.timestamp });
}

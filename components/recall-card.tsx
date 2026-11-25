"use client";

/**
 * Fork (#806 E2, D-023): the recall rating card — the renderer of the tutor's
 * `propose_grade` tool part. "Graded against" the statement (with its
 * verification badge), then the learner's key: 1 Again / 2 Hard / 3 Good, the
 * tutor's pick outlined as "suggested" (Enter accepts it); "Dispute (D)" opens
 * an optional one-line reason. The key is POSTed to the silent grade route;
 * once saved, the app asks the tutor for the next question (no user bubble —
 * the saved-grade marker is the turn's input) unless it was the last statement,
 * where the card closes with a summary built from the saved keys.
 */
import { useContext, useEffect, useRef, useState } from "react";
import { ChatActionsContext } from "@/components/chat";
import { formatDue } from "@/components/review-view";
import { useReviewPayload } from "@/components/review-payload-hook";
import { VerificationBadge } from "@/components/verification-badge";
import {
	RECALL_REASON_MAX,
	allGraded,
	latestGradeCallId,
	latestUnansweredCardId,
	nextDueAt,
	recallKeyAction,
	recallPicksOf,
	recallSavedText,
	recallSummary,
	savedGradesOf,
	type ArtifactPartProps,
	type RecallKey,
	type RecallRating,
} from "@/src/core";

const LABEL: Record<RecallKey, string> = { again: "Again", hard: "Hard", good: "Good", dispute: "Disputed" };
const RATINGS: readonly RecallRating[] = ["again", "hard", "good"];

/** The hint under the keys: the schedule takes the lower of the two. */
export function recallHint(pick: RecallRating): string {
	return pick === "good"
		? `Enter accepts Good. The schedule uses the lower of your key and the tutor's.`
		: `Enter accepts ${LABEL[pick]}. Picking higher still schedules ${LABEL[pick]} (lower of the two).`;
}

function isTextField(el: EventTarget | null): boolean {
	const t = el as HTMLElement | null;
	return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** The closing card: counts per scheduled grade, disputes, the soonest next due date. */
function RecallSummaryCard({ messages, pending }: { messages: Parameters<typeof recallSummary>[0]; pending?: Parameters<typeof recallSummary>[1] }) {
	const payload = useReviewPayload();
	const s = recallSummary(messages, pending);
	const due = nextDueAt(payload, s.gradedNodeIds);
	return (
		<div data-testid="recall-summary" className="mt-3 border-t border-border/50 pt-3 text-sm">
			<p className="text-xs uppercase tracking-widest text-muted-foreground/70">Recall done · {s.total} statement{s.total === 1 ? "" : "s"}</p>
			<p className="mt-1">Again {s.again} · Hard {s.hard} · Good {s.good}{s.disputed > 0 ? ` · Disputed ${s.disputed}` : ""}</p>
			<p className="mt-0.5 text-xs text-muted-foreground">
				{due !== null && payload ? `Next due: ${formatDue(due, payload.now)} (${new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" })})` : payload ? "Next due: nothing scheduled" : "Next due: …"}
			</p>
		</div>
	);
}

export function RecallGradeCard({ part }: ArtifactPartProps) {
	const actions = useContext(ChatActionsContext);
	const recall = actions?.recall;
	const [local, setLocal] = useState<{ key: RecallKey } | null>(null);
	const [posting, setPosting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nextError, setNextError] = useState(false); // the grade is saved, the next question failed
	const [disputing, setDisputing] = useState(false);
	const [reason, setReason] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	const messages = recall?.messages ?? [];
	const input = (part.input ?? {}) as { nodeId?: unknown; rating?: unknown };
	const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
	const suggested = RATINGS.find((r) => r === input.rating);
	const pick = recallPicksOf(messages).find((p) => p.id === nodeId);
	const saved = savedGradesOf(messages).get(part.toolCallId);
	const key = saved?.key ?? local?.key ?? null;
	const live = !key && part.state === "output-available" && latestUnansweredCardId(messages) === part.toolCallId;
	const disabled = !live || posting || !!recall?.busy || disputing;

	const post = async (k: RecallKey, why?: string) => {
		if (!recall || posting) return;
		setPosting(true);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${encodeURIComponent(actions!.chatId)}/grade`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ toolCallId: part.toolCallId, key: k, ...(why ? { reason: why } : {}) }),
			});
			if (!res.ok) {
				setError(res.status === 409 ? "The tutor is still working — try again in a moment." : "Could not save the grade.");
				return;
			}
		} catch {
			setError("Could not save the grade.");
			setPosting(false);
			return;
		}
		setLocal({ key: k });
		setDisputing(false);
		await next(!allGraded(messages, nodeId));
	};
	// Auto-next: adopt the record, then ask for the next question unless that was the last.
	const next = async (ask: boolean) => {
		if (!recall) return;
		setNextError(false);
		try {
			await recall.continueTurn(ask);
		} catch {
			setNextError(true);
		} finally {
			setPosting(false);
		}
	};
	const postRef = useRef(post);
	postRef.current = post;

	useEffect(() => {
		if (disabled) return;
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			const action = recallKeyAction(e, { inTextField: isTextField(e.target), onButton: el?.tagName === "BUTTON" || el?.tagName === "A", disabled: false, suggested });
			if (!action) return;
			e.preventDefault();
			if (action === "dispute") { setDisputing(true); return; }
			void postRef.current(action === "accept" ? suggested! : action);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [disabled, suggested]);

	useEffect(() => { if (disputing) inputRef.current?.focus(); }, [disputing]);

	// Owner (2026-11-25): when the card goes live, move focus to it so the keys work
	// at once; the composer keeps focus after sending otherwise. Clicking the composer
	// still lets the learner write to the tutor.
	const cardRef = useRef<HTMLDivElement | null>(null);
	const keysReady = live && !posting && !recall?.busy && !disputing;
	// Review fix: never take focus from a field the learner is typing in.
	useEffect(() => {
		if (!keysReady) return;
		const el = document.activeElement as HTMLElement | null;
		if (el && isTextField(el) && ((el as HTMLInputElement).value || el.textContent || "").trim() !== "") return;
		cardRef.current?.focus({ preventScroll: true });
	}, [keysReady]);

	if (!recall || part.state !== "output-available" || !nodeId) return null;
	const isLast = latestGradeCallId(messages) === part.toolCallId;
	const showSummary = !!key && isLast && allGraded(messages, nodeId);
	const badge = pick?.verification && pick.verification !== "none" ? { status: pick.verification } : undefined;

	return (
		<div ref={cardRef} tabIndex={-1} data-testid="recall-card" data-live={live ? "true" : "false"} className="rounded-lg border border-border/60 px-4 py-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring">
			<p className="text-xs uppercase tracking-widest text-muted-foreground/70">Graded against</p>
			<div className="mt-1 flex min-w-0 items-start gap-2">
				<div className="min-w-0 flex-1">
					<p className="flex items-center gap-2"><span className="truncate">{pick?.name ?? nodeId}</span><VerificationBadge verification={badge} /></p>
					{pick && <p className="text-xs text-muted-foreground">{pick.statement}</p>}
				</div>
			</div>
			{key ? (
				<>
					<p data-testid="recall-saved" className="mt-3 text-sm">{recallSavedText(key, saved?.tutorRating ?? suggested)}</p>
					{nextError && (
						<p role="alert" className="mt-1 text-xs text-destructive">
							Couldn't get the next question.{" "}
							<button type="button" data-testid="recall-next-retry" disabled={posting || !!recall.busy} onClick={() => void next(!allGraded(messages))} className="underline underline-offset-2 disabled:opacity-50">Retry</button>
						</p>
					)}
				</>
			) : !live && !posting ? (
				// Owner (2026-11-26): a card a newer question replaced before it was keyed saves no grade.
				<p data-testid="recall-skipped" className="mt-3 text-xs text-muted-foreground">Skipped · still due</p>
			) : (
				<div className="mt-3 flex flex-col gap-2">
					{!suggested && <p className="text-xs text-muted-foreground">Rate yourself</p>}
					<div className="flex flex-wrap items-center gap-2">
						{RATINGS.map((r, i) => (
							<button
								key={r}
								type="button"
								data-testid={`recall-key-${r}`}
								disabled={disabled}
								onClick={() => void post(r)}
								className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 ${suggested === r ? "border-foreground/70" : "border-border"}`}
							>
								<kbd className="font-mono text-[10px] text-muted-foreground">{i + 1}</kbd>
								{LABEL[r]}
								{suggested === r && <span className="text-[10px] text-muted-foreground">suggested</span>}
							</button>
						))}
						{!disputing && (
							<button type="button" data-testid="recall-dispute" disabled={!live || posting || !!recall.busy} onClick={() => setDisputing(true)} className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50">
								Dispute (D)
							</button>
						)}
					</div>
					{suggested && <p data-testid="recall-hint" className="text-xs text-muted-foreground">{recallHint(suggested)}</p>}
					{disputing && (
						<input
							ref={inputRef}
							data-testid="recall-dispute-reason"
							value={reason}
							maxLength={RECALL_REASON_MAX}
							placeholder="Why? (optional, Enter to submit, Esc to cancel)"
							aria-label="Dispute reason"
							onChange={(e) => setReason(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void post("dispute", reason.trim() || undefined); }
								else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDisputing(false); }
							}}
							className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
						/>
					)}
					{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
				</div>
			)}
			{showSummary && <RecallSummaryCard messages={messages} pending={!saved && local ? { toolCallId: part.toolCallId, nodeId, key: local.key, ...(suggested ? { tutorRating: suggested } : {}), at: Date.now() } : undefined} />}
		</div>
	);
}

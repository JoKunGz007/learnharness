"use client";

/**
 * Fork (#806 D): the verification badge beside a node's name (graph detail
 * card, review rows). corrected / doubtful are small chips; verified is a
 * quiet check. The tooltip carries what changed and where it was checked.
 * No verification, no badge.
 */
import { CheckIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { latestDispute, type NodeVerification, type ReviewDispute } from "@/src/core";

export type VerificationSummary = Pick<NodeVerification, "status" | "oldText" | "note" | "source">;

/** The tooltip's lines, as plain data (the pure seam the render pins read). */
export function verificationTipLines(v: VerificationSummary): { text: string; url?: string }[] {
	const lines: { text: string; url?: string }[] = [];
	if (v.status === "corrected" && v.oldText) lines.push({ text: `Was: ${v.oldText}` });
	if (v.note) lines.push({ text: v.note });
	if (v.source) lines.push({ text: `Source: ${v.source.label}`, ...(v.source.url ? { url: v.source.url } : {}) });
	return lines;
}

function TipBody({ verification }: { verification: VerificationSummary }) {
	const lines = verificationTipLines(verification);
	return (
		<div data-testid="verification-tip" className="flex max-w-xs flex-col gap-0.5">
			{lines.map((line, i) =>
				line.url ? (
					<a key={i} href={line.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
						{line.text}
					</a>
				) : (
					<span key={i}>{line.text}</span>
				),
			)}
		</div>
	);
}

export function VerificationBadge({ verification }: { verification?: VerificationSummary }) {
	if (!verification) return null;
	const { status } = verification;
	const hasTip = verificationTipLines(verification).length > 0;
	const trigger = (
		<button
			type="button"
			data-testid={`verification-badge-${status}`}
			aria-label={status === "verified" ? "verified" : undefined}
			onClick={(e) => e.stopPropagation()}
			className={
				status === "verified"
					? "inline-flex shrink-0 items-center rounded p-0.5 text-success/80 outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
					: status === "corrected"
						? "inline-flex shrink-0 items-center rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-blue-700 dark:text-blue-300 outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
						: "inline-flex shrink-0 items-center rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
			}
		>
			{status === "verified" ? <CheckIcon className="size-3.5" aria-hidden /> : status}
		</button>
	);
	if (!hasTip) return trigger;
	return (
		<TooltipProvider>
			<Tooltip disableHoverableContent={false}>
				<TooltipTrigger asChild>{trigger}</TooltipTrigger>
				<TooltipContent side="top">
					<TipBody verification={verification} />
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/** Fork (#806 E2): the "disputed" chip beside a statement on /review — the learner
 *  disputed a recall grade since the last counted review. Neutral tone (a flag,
 *  not a verdict); the latest reason rides the tooltip (hover and focus). */
export function DisputeChip({ disputes }: { disputes?: readonly ReviewDispute[] }) {
	const latest = latestDispute(disputes);
	if (!latest) return null;
	return (
		<TooltipProvider>
			<Tooltip disableHoverableContent={false}>
				<TooltipTrigger asChild>
					<button
						type="button"
						data-testid="dispute-chip"
						onClick={(e) => e.stopPropagation()}
						className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
					>
						disputed
					</button>
				</TooltipTrigger>
				<TooltipContent side="top">
					<span data-testid="dispute-tip" className="block max-w-xs">{latest.reason ? `Your reason: ${latest.reason}` : "You disputed this grade (no reason given)."}</span>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

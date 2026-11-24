"use client";

/**
 * Fork (#806 D): the verification badge beside a node's name (graph detail
 * card, review rows). corrected / doubtful are small chips; verified is a
 * quiet check. The tooltip carries what changed and where it was checked.
 * No verification, no badge.
 */
import { CheckIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { NodeVerification } from "@/src/core";

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

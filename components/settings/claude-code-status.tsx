"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLAUDE_CODE_MINIMUM_VERSION, type ClaudeCodeAuth, type ClaudeCodeStatus, type UserSettings } from "@/src/core";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { Toggle } from "./controls";

// Fork: wording carried over from the old local-agent connection dialog.
export const CLAUDE_CODE_BACKGROUND_HINT = "Allow LearnHarness helper agents and automatic follow-ups to use this connection.";

/** Fork: signed-in line from `claude auth status`; null when the CLI was not asked. */
export function claudeCodeAuthLines(auth: ClaudeCodeAuth | undefined): { text: string; warning?: string } | null {
	switch (auth?.state) {
		case "signed-in": return {
			text: `Signed in${auth.account ? ` as ${auth.account}` : ""}${auth.plan ? ` · ${auth.plan} plan` : ""}.`,
			...(auth.usesSubscription === false ? { warning: "Claude Code is signed in without an Anthropic subscription, so usage is billed to that account." } : {}),
		};
		case "signed-out": return { text: "Not signed in. Run claude auth login in a terminal, then Check again." };
		case "uncertain": return { text: "Sign-in status could not be checked." };
		default: return null;
	}
}

export function claudeCodeStatusLabel(status: ClaudeCodeStatus | null): string {
	switch (status?.state) {
		case "not-found": return "Not found";
		case "meets-minimum": return `Version ${status.version} · meets minimum`;
		case "update-required": return `Version ${status.version} · update required`;
		default: return "Version could not be checked";
	}
}

export function ClaudeCodeInstallationStatus() {
	const [enabled, setEnabled] = useState(false);
	const [background, setBackground] = useState(true); // Fork: old default on
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);
	const settingsRead = useRef<AbortController | null>(null);
	const settingsWrite = useRef<AbortController | null>(null);

	const read = useCallback(async () => {
		settingsRead.current?.abort();
		const controller = new AbortController();
		settingsRead.current = controller;
		setLoaded(false);
		try {
			const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("settings unavailable");
			const body = await response.json() as { settings: UserSettings | null };
			if (!controller.signal.aborted) {
				setEnabled(body.settings?.claudeCode?.enabled === true);
				setBackground(body.settings?.claudeCode?.allowBackgroundUse !== false);
				setLoaded(true);
				setError(null);
			}
		} catch {
			if (!controller.signal.aborted) setError("Could not load Claude Code settings.");
		}
	}, []);
	useEffect(() => {
		void read();
		return () => { settingsRead.current?.abort(); settingsWrite.current?.abort(); };
	}, [read]);
	useSettingsSaved((section) => { if (section === "claudeCode") void read(); });

	const save = async (next: boolean, nextBackground = background) => {
		const controller = new AbortController();
		settingsWrite.current = controller;
		settingsRead.current?.abort();
		setSaving(true);
		setError(null);
		try {
			const response = await fetch("/api/settings/claudeCode", { method: "PUT", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: next, allowBackgroundUse: nextBackground }), signal: controller.signal });
			if (!response.ok) throw new Error("settings write failed");
			const body = await response.json() as { settings: UserSettings };
			if (typeof body.settings?.claudeCode?.enabled !== "boolean") throw new Error("invalid settings response");
			if (!controller.signal.aborted) {
				setEnabled(body.settings.claudeCode.enabled);
				setBackground(body.settings.claudeCode.allowBackgroundUse !== false);
				notifySettingsSaved("claudeCode");
			}
		} catch {
			if (!controller.signal.aborted) setError("Could not save Claude Code settings.");
		} finally {
			if (!controller.signal.aborted) setSaving(false);
		}
	};

	const refresh = useCallback(async () => {
		if (!enabled) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		try {
			const response = await fetch("/api/claude-code", { cache: "no-store", signal: controller.signal, headers: { "x-learnharness-claude-code": "1" } });
			if (!response.ok) throw new Error("status unavailable");
			const value = await response.json() as ClaudeCodeStatus;
			if (!["not-found", "meets-minimum", "update-required", "version-unchecked"].includes(value.state)
				|| value.minimumVersion !== CLAUDE_CODE_MINIMUM_VERSION
				|| (value.auth !== undefined && !["signed-in", "signed-out", "uncertain"].includes(value.auth.state))
				|| (value.version !== null && (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)))) throw new Error("invalid status");
			if (!controller.signal.aborted) setStatus(value);
		} catch {
			if (!controller.signal.aborted) setStatus(null);
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}, [enabled]);
	useEffect(() => {
		if (enabled) void refresh();
		else { request.current?.abort(); setStatus(null); setBusy(false); }
		return () => request.current?.abort();
	}, [enabled, refresh]);

	return <div className="space-y-2" data-testid="claude-code-installation">
		<div className="flex items-center gap-3">
			<span className="font-prose text-(length:--lh-prose-size) text-foreground">Claude Code</span>
			<Toggle label="Claude Code" checked={enabled} disabled={!loaded || saving} onChange={(next) => void save(next)} />
		</div>
		{error && <p role="alert" className="text-xs text-red-400">{error}</p>}
		{enabled && <>
			<div className="flex flex-wrap items-center gap-3">
				<span role="status" className="text-xs text-muted-foreground">{busy ? "Checking…" : claudeCodeStatusLabel(status)}</span>
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy} onClick={() => void refresh()} data-testid="claude-code-check-again">Check again</Button>
			</div>
			{(() => { const lines = claudeCodeAuthLines(status?.auth); return lines && <>
				<p className="text-xs" data-testid="claude-code-account">{lines.text}</p>
				{lines.warning && <p className="text-xs text-amber-400" data-testid="claude-code-billing-warning">{lines.warning}</p>}
			</>; })()}
			<div className="flex items-center gap-3 text-xs text-foreground">
				<Toggle label="Allow background use" checked={background} disabled={!loaded || saving} onChange={(next) => void save(enabled, next)} />
				<span>Allow background use<span className="mt-1 block leading-relaxed text-muted-foreground">{CLAUDE_CODE_BACKGROUND_HINT}</span></span>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground"><strong className="font-medium">Install and authenticate Claude Code in your terminal, then select a Claude Code model here.</strong> LearnHarness starts it when needed—no background process required.</p>
			<p className="text-xs leading-relaxed text-muted-foreground">Checks installation, version and sign-in—not model access or quota. Claude Code controls billing. Requires v{CLAUDE_CODE_MINIMUM_VERSION}+. <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Setup ↗</a></p>
			<p className="text-xs leading-relaxed text-muted-foreground">Verify AI claims independently—they may be inaccurate, incomplete, misleading, or outdated.</p>
		</>}
	</div>;
}

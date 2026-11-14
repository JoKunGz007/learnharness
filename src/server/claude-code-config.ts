import { getClaudeBinary } from "../agent/claude-code/binary.ts";
import { notifySubscriptionChange, setClaudeCodeBackgroundGate } from "../agent/subscription-connections.ts";
import { settingsStore } from "../store/settings.ts";

/** Fresh admission state, not a process-wide cache. Existing runs retain
 * their engines; only new chat/job/extraction/compaction admissions consult it. */
export function claudeCodeEnabled(): boolean {
	return settingsStore.readSettings()?.claudeCode?.enabled === true;
}

/** Fork: helper agents and automatic follow-ups may use Claude Code. Default on (the old local-agent default);
 * a fresh check at each admission, like the opt-in. */
export function claudeCodeBackgroundAllowed(): boolean {
	const cc = settingsStore.readSettings()?.claudeCode;
	// Installed too, like upstream's own check (providerKeyPresent): with the binary gone, background work stays deferred instead of failing at spawn.
	return cc?.enabled === true && cc.allowBackgroundUse !== false && getClaudeBinary() !== null;
}

/** Installation/opt-in availability only, never authenticated readiness. */
export function claudeCodeAvailable(): boolean {
	return claudeCodeEnabled() && getClaudeBinary() !== null;
}

/** Fork: install the claude-code gate into connectionBackgroundAllowed (idempotent; every entry that needs it calls this). */
export function installClaudeCodeBackgroundGate(): void { setClaudeCodeBackgroundGate(claudeCodeBackgroundAllowed); }
/** Fork: after claudeCode settings are saved, wake/defer background work via onSubscriptionChange listeners. */
export function claudeCodeSettingsChanged(): void { notifySubscriptionChange(); }

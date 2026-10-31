import { chatGPTBackgroundAllowed, chatGPTConnected, chatGPTScopeCurrent, onChatGPTChange } from "./chatgpt-bridge.ts";
import { nativeSubscriptionId, nativeSubscriptionConnected, nativeSubscriptionBackgroundAllowed, nativeAdmissionCurrent, onNativeSubscriptionChange } from "./subscription-bridge.ts";
import { CLAUDE_CODE_PROVIDER } from "./claude-code/constants.ts"; // Fork
import type { AdmissionScope } from "./subscription-request-cycle.ts";

/** Subscription-backed routes: app-owned sign-ins (ChatGPT, Copilot, Grok). */
export function isSubscriptionProvider(provider: string | undefined): boolean { return provider === "chatgpt" || !!(provider && nativeSubscriptionId(provider)); }
export function subscriptionConnected(provider: string): boolean {
	if (provider === "chatgpt") return chatGPTConnected();
	const native = nativeSubscriptionId(provider); return !!native && nativeSubscriptionConnected(native);
}
/** Fork: injected claude-code background gate (like setFileAccessPolicy) plus change listeners. On globalThis because
 *  modules are bundled into several route chunks; the composition root installs the gate. */
type ForkState = { gate: () => boolean; listeners: Set<() => void> };
const FORK_KEY = Symbol.for("learnharness.claudeCodeGate");
function fork(): ForkState { const g = globalThis as typeof globalThis & { [FORK_KEY]?: ForkState }; return g[FORK_KEY] ??= { gate: () => true, listeners: new Set() }; }
export function setClaudeCodeBackgroundGate(gate: () => boolean): void { fork().gate = gate; }
/** Fork: tell onSubscriptionChange listeners that claude-code settings changed (toggle defers or wakes work). */
export function notifySubscriptionChange(): void { for (const listener of [...fork().listeners]) { try { listener(); } catch { /* observer isolation */ } } }
/** Ordinary API connections have no subscription background-consent gate. */
export function connectionBackgroundAllowed(provider: string | undefined): boolean {
	if (provider === CLAUDE_CODE_PROVIDER) return fork().gate(); // Fork
	if (provider === "chatgpt") return chatGPTBackgroundAllowed();
	const native = provider ? nativeSubscriptionId(provider) : undefined;
	return native ? nativeSubscriptionBackgroundAllowed(native) : true;
}
export function connectionScopeCurrent(provider: string, scope: AdmissionScope): boolean {
	if (provider === "chatgpt") return chatGPTScopeCurrent(scope);
	const native = nativeSubscriptionId(provider); return !!native && nativeAdmissionCurrent(native, scope);
}
export function onSubscriptionChange(listener: () => void): () => void {
	const stopChatGPT = onChatGPTChange(listener), stopNative = onNativeSubscriptionChange(listener), set = fork().listeners; set.add(listener); // Fork: claude-code settings
	return () => { stopChatGPT(); stopNative(); set.delete(listener); };
}

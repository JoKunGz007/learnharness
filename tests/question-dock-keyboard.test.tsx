import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { QuestionDock } from "../components/question-dock.tsx";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true });

test("choices opened from the scrolled-up row answer the keyboard", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(
		<QuestionDock toolName="ask_user_question" toolCallId="a1" input={{ question: "Pick", options: [{ label: "One" }, { label: "Two" }] }} expanded={false} onExpand={() => {}} onSubmit={() => {}} />,
	));
	const key = () => { const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true }) as Event & { key: string }; e.key = "Tab"; document.dispatchEvent(e); window.dispatchEvent(e); return e.defaultPrevented; };
	assert.equal(key(), false, "closed choices leave the keys alone");
	await act(async () => (document.querySelector('[data-testid="question-dock-peek"]') as HTMLElement).click());
	assert.equal(key(), true, "open choices take Tab");
	await act(async () => root.unmount());
	host.remove();
});

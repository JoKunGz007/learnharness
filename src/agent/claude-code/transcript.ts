import type { ImageContent, Message, TextContent, Tool } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";

export type ClaudeContentBlock = (
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
) & { cache_control?: { type: "ephemeral"; ttl: "1h" } }; // Fork: cache_control

export type ClaudeInput = {
	systemPrompt: string;
	tools: Tool[];
	userContent: ClaudeContentBlock[];
};

type ReplayPart = string | ImageContent;

function toImageBlock(image: ImageContent): ClaudeContentBlock {
	return { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } };
}

function getLabelledParts(label: string, content: string | (TextContent | ImageContent)[]): ReplayPart[] {
	if (typeof content === "string") return [`${label}\n${content}`];

	const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
	const images = content.filter((block) => block.type === "image");

	return [text ? `${label}\n${text}` : label, ...images];
}

function getReplayParts(message: Message): ReplayPart[] {
	switch (message.role) {
		case "system":
			return [];

		case "user":
			return getLabelledParts("[user]", message.content);

		case "assistant":
			return message.content.flatMap((block) => {
				if (block.type === "text") return [`[assistant]\n${block.text}`];
				if (block.type === "toolCall") return [`[tool call ${block.name}] ${JSON.stringify(block.arguments)}`];
				return [];
			});

		case "toolResult": {
			const label = message.isError ? `[tool result ${message.toolName} error]` : `[tool result ${message.toolName}]`;
			return getLabelledParts(label, message.content);
		}
	}
}

function toContentBlocks(parts: ReplayPart[]): ClaudeContentBlock[] {
	const blocks: ClaudeContentBlock[] = [];
	let pendingText: string[] = [];

	const flushText = () => {
		if (pendingText.length > 0) blocks.push({ type: "text", text: pendingText.join("\n\n") });
		pendingText = [];
	};

	for (const part of parts) {
		if (typeof part === "string") {
			pendingText.push(part);
		} else {
			flushText();
			blocks.push(toImageBlock(part));
		}
	}

	flushText();

	return blocks;
}

function toUnlabelledBlocks(content: string | (TextContent | ImageContent)[]): ClaudeContentBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];

	return content.map((block) => (block.type === "text" ? { type: "text", text: block.text } : toImageBlock(block)));
}

// Fork: the re-sent history is cut every HISTORY_CHUNK messages, counted from the start of the
// conversation, so a chunk's blocks never change once it is full. A cache entry only matches on a
// whole-block boundary: one merged block (upstream) grows every turn and never matches again.
// Not cut per user message: in a lesson the learner's answers are tool results, so everything
// after the first message would be one growing run. 8 keeps a long gap between two fresh
// processes inside the API's 20-block lookback (about 160 messages).
export const HISTORY_CHUNK = 8;

function toHistoryBlocks(history: Message[]): ClaudeContentBlock[] {
	const chunks: ClaudeContentBlock[][] = [];
	let lastFull = -1;

	for (let start = 0; start < history.length; start += HISTORY_CHUNK) {
		const messages = history.slice(start, start + HISTORY_CHUNK);
		const blocks = toContentBlocks(messages.flatMap(getReplayParts));
		if (blocks.length === 0) continue;
		if (messages.length === HISTORY_CHUNK) lastFull = chunks.length;
		chunks.push(blocks);
	}

	// The breakpoint goes after the last FULL chunk: the open chunk's end is not a block boundary
	// next turn. With no full chunk yet it stays on the last block, as before.
	const marked = chunks[lastFull >= 0 ? lastFull : chunks.length - 1];
	const last = marked?.at(-1);
	if (marked && last) marked[marked.length - 1] = { ...last, cache_control: { type: "ephemeral", ttl: "1h" } };

	return chunks.flat();
}

function toUserContent(conversation: Message[]): ClaudeContentBlock[] {
	const [first] = conversation;
	if (conversation.length === 1 && first?.role === "user") return toUnlabelledBlocks(first.content);

	// Fork: a prompt-cache breakpoint after the re-sent history (everything before the newest message),
	// so the next turn's fresh process, which starts with the same history, reads it back instead of
	// re-writing it. 1h matches the TTL Claude Code uses for its own breakpoints.
	return [...toHistoryBlocks(conversation.slice(0, -1)), ...toContentBlocks(conversation.slice(-1).flatMap(getReplayParts))];
}

export function toClaudeInput(messages: Message[]): ClaudeInput {
	const conversation = messages.filter((message) => message.role !== "system");

	return {
		systemPrompt: getCurrentSystemPrompt(messages),
		tools: getCurrentTools(messages),
		userContent: toUserContent(conversation),
	};
}

export function toStreamJsonLine(content: ClaudeContentBlock[]): string {
	return JSON.stringify({ type: "user", message: { role: "user", content } });
}

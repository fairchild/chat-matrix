/**
 * AG-UI, from the pi child's events. Event names follow the AG-UI core spec;
 * the request shape is `RunAgentInput` (`threadId`, `runId`, `messages`).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, ToolCall } from "@earendil-works/pi-ai";

import type { PiEvent } from "./pi.ts";
import { toolOutput, userText, type Chunk, type Protocol, type Turn } from "./protocol.ts";

type InputContent = string | { type: string; text?: string; image?: string; mimeType?: string }[];
type InputMessage = { id?: string; role: string; content?: InputContent };
export type RunAgentInput = { threadId?: string; runId?: string; messages?: InputMessage[] };

export function turnFromRun(body: RunAgentInput): Turn {
  const last = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
  const content = last?.content ?? "";
  if (typeof content === "string") return { text: content, images: [] };
  const images: ImageContent[] = [];
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  for (const part of content)
    if (part.type === "image" && part.image && part.mimeType)
      images.push({ type: "image", mimeType: part.mimeType, data: part.image });
  return { text, images };
}

export function aguiProtocol(threadId: string, runId: string): Protocol {
  const stamp = (chunk: Chunk): Chunk => ({ ...chunk, timestamp: Date.now() });
  let parentMessageId = crypto.randomUUID();
  let messageIds = new Map<number, string>();
  const idFor = (contentIndex: number) => {
    let id = messageIds.get(contentIndex);
    if (!id) messageIds.set(contentIndex, (id = crypto.randomUUID()));
    return id;
  };
  // As in vercel.ts: the wire's `toolcall_start` carries no id, so a call's
  // START/ARGS/END go out together once `toolcall_end` names it.
  let argDeltas = new Map<number, string[]>();

  return {
    headers: {},

    begin: () => [stamp({ type: "RUN_STARTED", threadId, runId })],
    end: () => [stamp({ type: "RUN_FINISHED", threadId, runId, outcome: { type: "success" } })],
    fail: (message) => [stamp({ type: "RUN_ERROR", message })],

    event(event: PiEvent): Chunk[] {
      switch (event.type) {
        case "message_start":
          if (event.message.role === "assistant") {
            parentMessageId = crypto.randomUUID();
            messageIds = new Map();
            argDeltas = new Map();
          }
          return [];
        case "message_end":
          return event.message.role === "assistant" && event.message.stopReason === "error"
            ? [stamp({ type: "RUN_ERROR", message: event.message.errorMessage ?? "model error" })]
            : [];
        case "tool_execution_end": {
          const output = toolOutput(event.result);
          return [
            stamp({
              type: "TOOL_CALL_RESULT",
              messageId: crypto.randomUUID(),
              toolCallId: event.toolCallId,
              content: typeof output === "string" ? output : JSON.stringify(output),
              role: "tool",
            }),
          ];
        }
        case "message_update": {
          const e = event.assistantMessageEvent;
          switch (e.type) {
            case "text_start":
              return [stamp({ type: "TEXT_MESSAGE_START", messageId: idFor(e.contentIndex), role: "assistant" })];
            case "text_delta":
              return [stamp({ type: "TEXT_MESSAGE_CONTENT", messageId: idFor(e.contentIndex), delta: e.delta })];
            case "text_end":
              return [stamp({ type: "TEXT_MESSAGE_END", messageId: idFor(e.contentIndex) })];
            case "thinking_start":
              return [
                stamp({ type: "THINKING_START" }),
                stamp({ type: "THINKING_TEXT_MESSAGE_START" }),
              ];
            case "thinking_delta":
              return [stamp({ type: "THINKING_TEXT_MESSAGE_CONTENT", delta: e.delta })];
            case "thinking_end":
              return [stamp({ type: "THINKING_TEXT_MESSAGE_END" }), stamp({ type: "THINKING_END" })];
            case "toolcall_start":
              argDeltas.set(e.contentIndex, []);
              return [];
            case "toolcall_delta":
              argDeltas.get(e.contentIndex)?.push(e.delta);
              return [];
            case "toolcall_end": {
              const { id: toolCallId, name: toolCallName } = e.toolCall;
              const deltas = argDeltas.get(e.contentIndex) ?? [];
              argDeltas.delete(e.contentIndex);
              return [
                stamp({ type: "TOOL_CALL_START", toolCallId, toolCallName, parentMessageId }),
                ...deltas.map((delta) => stamp({ type: "TOOL_CALL_ARGS", toolCallId, delta })),
                stamp({ type: "TOOL_CALL_END", toolCallId }),
              ];
            }
            default:
              return [];
          }
        }
        default:
          return [];
      }
    },

    /** Stored pi messages as AG-UI `Message`s — a near-direct mapping, since AG-UI keeps tool results as their own role. */
    dump(threadId, messages: AgentMessage[]): unknown[] {
      const out: unknown[] = [];
      messages.forEach((message, index) => {
        const id = `${threadId}-${index}`;
        if (message.role === "user") {
          out.push({ id, role: "user", content: userText(message) });
        } else if (message.role === "assistant" && message.content.length) {
          const text = message.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("");
          const toolCalls = message.content
            .filter((block): block is ToolCall => block.type === "toolCall")
            .map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            }));
          out.push({
            id,
            role: "assistant",
            content: text || undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined,
          });
        } else if (message.role === "toolResult") {
          const output = toolOutput(message);
          out.push({
            id,
            role: "tool",
            content: typeof output === "string" ? output : JSON.stringify(output),
            toolCallId: message.toolCallId,
            ...(message.isError ? { error: String(output) } : {}),
          });
        }
      });
      return out;
    },
  };
}

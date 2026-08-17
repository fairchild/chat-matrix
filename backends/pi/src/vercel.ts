/**
 * The Vercel AI data stream protocol (UI message stream, AI SDK v7), from pi's
 * session events. Chunk names follow the SDK's `UIMessageChunk` union; the
 * request shape is `useChat`'s `{ id, messages: UIMessage[] }`.
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, ToolCall } from "@earendil-works/pi-ai";

import { toolOutput, type Chunk, type Protocol, type Turn } from "./protocol.ts";

type UIPart = { type: string; text?: string; mediaType?: string; url?: string };
type UIMessage = { id?: string; role: string; parts?: UIPart[] };
export type ChatRequest = { id?: string; messages?: UIMessage[] };

const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;

/** The latest user message: text parts become the prompt, image files become pi images. */
export function turnFromChat(body: ChatRequest): Turn {
  const last = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
  const parts = last?.parts ?? [];
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const images: ImageContent[] = [];
  for (const part of parts) {
    if (part.type !== "file" || !part.mediaType?.startsWith("image/") || !part.url) continue;
    const match = DATA_URL.exec(part.url);
    if (match?.[2]) images.push({ type: "image", mimeType: part.mediaType, data: match[3]! });
  }
  return { text, images };
}

export function vercelProtocol(): Protocol {
  // Text and reasoning blocks need a stable id across start/delta/end.
  let blockIds = new Map<number, string>();
  const idFor = (contentIndex: number) => {
    let id = blockIds.get(contentIndex);
    if (!id) blockIds.set(contentIndex, (id = crypto.randomUUID()));
    return id;
  };
  // pi emits `tool-input-available` as each call's arguments close; the reference
  // emits them together after the model's turn. Hold them and flush on message_end.
  let heldAvailable: Chunk[] = [];

  return {
    headers: { "x-vercel-ai-ui-message-stream": "v1" },
    trailer: "data: [DONE]\n\n",

    begin: () => [{ type: "start" }],
    end: () => [{ type: "finish" }],
    fail: (message) => [{ type: "error", errorText: message }, { type: "finish" }],

    event(event: AgentSessionEvent): Chunk[] {
      switch (event.type) {
        case "turn_start":
          return [{ type: "start-step" }];
        case "turn_end":
          return [{ type: "finish-step" }];
        case "message_start":
          if (event.message.role === "assistant") {
            blockIds = new Map();
            heldAvailable = [];
          }
          return [];
        case "message_end": {
          if (event.message.role !== "assistant") return [];
          const available = heldAvailable;
          heldAvailable = [];
          return event.message.stopReason === "error"
            ? [...available, { type: "error", errorText: event.message.errorMessage ?? "model error" }]
            : available;
        }
        case "tool_execution_end":
          return event.isError
            ? [
                {
                  type: "tool-output-error",
                  toolCallId: event.toolCallId,
                  errorText: String(toolOutput(event.result)),
                },
              ]
            : [{ type: "tool-output-available", toolCallId: event.toolCallId, output: toolOutput(event.result) }];
        case "message_update": {
          const e = event.assistantMessageEvent;
          switch (e.type) {
            case "text_start":
              return [{ type: "text-start", id: idFor(e.contentIndex) }];
            case "text_delta":
              return [{ type: "text-delta", delta: e.delta, id: idFor(e.contentIndex) }];
            case "text_end":
              return [{ type: "text-end", id: idFor(e.contentIndex) }];
            case "thinking_start":
              return [{ type: "reasoning-start", id: idFor(e.contentIndex) }];
            case "thinking_delta":
              return [{ type: "reasoning-delta", delta: e.delta, id: idFor(e.contentIndex) }];
            case "thinking_end":
              return [{ type: "reasoning-end", id: idFor(e.contentIndex) }];
            case "toolcall_start": {
              const call = e.partial.content[e.contentIndex] as ToolCall;
              return [{ type: "tool-input-start", toolCallId: call.id, toolName: call.name }];
            }
            case "toolcall_delta": {
              const call = e.partial.content[e.contentIndex] as ToolCall;
              return [{ type: "tool-input-delta", toolCallId: call.id, inputTextDelta: e.delta }];
            }
            case "toolcall_end":
              heldAvailable.push({
                type: "tool-input-available",
                toolCallId: e.toolCall.id,
                toolName: e.toolCall.name,
                input: e.toolCall.arguments,
              });
              return [];
            default:
              return [];
          }
        }
        default:
          return [];
      }
    },

    /** Stored pi messages as `UIMessage`s: tool results fold into the assistant part that called them. */
    dump(threadId, messages: AgentMessage[]): unknown[] {
      const results = new Map<string, Extract<AgentMessage, { role: "toolResult" }>>();
      for (const message of messages)
        if (message.role === "toolResult") results.set(message.toolCallId, message);

      const out: unknown[] = [];
      messages.forEach((message, index) => {
        const id = `${threadId}-${index}`;
        if (message.role === "user") {
          const parts: UIPart[] = [];
          if (typeof message.content === "string") parts.push({ type: "text", text: message.content });
          else
            for (const part of message.content)
              parts.push(
                part.type === "text"
                  ? { type: "text", text: part.text }
                  : { type: "file", mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` },
              );
          out.push({ id, role: "user", parts });
        } else if (message.role === "assistant" && message.content.length) {
          const parts: unknown[] = message.content.map((block) => {
            if (block.type === "text") return { type: "text", text: block.text, state: "done" };
            if (block.type === "thinking") return { type: "reasoning", text: block.thinking, state: "done" };
            const result = results.get(block.id);
            const base = { type: `tool-${block.name}`, toolCallId: block.id, input: block.arguments };
            if (!result) return { ...base, state: "input-available" };
            if (result.isError) return { ...base, state: "output-error", errorText: String(toolOutput(result)) };
            return { ...base, state: "output-available", output: toolOutput(result) };
          });
          out.push({ id, role: "assistant", parts });
        }
      });
      return out;
    },
  };
}

/**
 * Threads are stored as AI SDK `ModelMessage`s, not as either wire format —
 * the analogue of the pydantic-ai backend storing `ModelMessage`s. Each
 * protocol gets a rendering path here, so `GET /threads/{id}` can serve the
 * same thread as either protocol and adding a protocol adds a function, not a
 * migration.
 */

import type { Message as AgUiMessage } from "@ag-ui/core";
import type { AssistantModelMessage, ModelMessage, ToolResultPart, UIMessage, UserModelMessage } from "ai";

type UIPart = UIMessage["parts"][number];

const stringify = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

const outputValue = (output: ToolResultPart["output"]): unknown => ("value" in output ? output.value : output);

const textOf = (content: UserModelMessage["content"] | AssistantModelMessage["content"]): string =>
  typeof content === "string"
    ? content
    : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const partsOf = (content: AssistantModelMessage["content"]) =>
  typeof content === "string" ? [{ type: "text" as const, text: content }] : content;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Stored history as AI SDK UI messages, tool calls folded into the assistant turn that made them. */
export function toUIMessages(messages: ModelMessage[]): UIMessage[] {
  const out: UIMessage[] = [];
  let assistant: UIMessage | null = null;

  messages.forEach((message, index) => {
    const id = `m${index}`;
    switch (message.role) {
      case "system":
        assistant = null;
        out.push({ id, role: "system", parts: [{ type: "text", text: message.content }] });
        break;
      case "user":
        assistant = null;
        out.push({ id, role: "user", parts: [{ type: "text", text: textOf(message.content) }] });
        break;
      case "assistant": {
        if (!assistant) out.push((assistant = { id, role: "assistant", parts: [] }));
        assistant.parts.push({ type: "step-start" });
        for (const part of partsOf(message.content)) {
          if (part.type === "text") assistant.parts.push({ type: "text", text: part.text, state: "done" });
          else if (part.type === "tool-call")
            assistant.parts.push({
              type: `tool-${part.toolName}`,
              toolCallId: part.toolCallId,
              state: "input-available",
              input: part.input,
            } as UIPart);
        }
        break;
      }
      case "tool":
        for (const part of message.content) {
          if (part.type !== "tool-result") continue;
          const target = assistant?.parts.find((candidate) => "toolCallId" in candidate && candidate.toolCallId === part.toolCallId);
          if (target) Object.assign(target, { state: "output-available", output: outputValue(part.output) });
        }
        break;
    }
  });
  return out;
}

/** Stored history as AG-UI messages: one tool message per result, tool calls on the assistant message. */
export function toAgUiMessages(messages: ModelMessage[]): AgUiMessage[] {
  return messages.flatMap((message, index): AgUiMessage[] => {
    const id = `m${index}`;
    switch (message.role) {
      case "system":
        return [{ id, role: "system", content: message.content }];
      case "user":
        return [{ id, role: "user", content: textOf(message.content) }];
      case "assistant": {
        const toolCalls = partsOf(message.content).flatMap((part) =>
          part.type === "tool-call"
            ? [{ id: part.toolCallId, type: "function" as const, function: { name: part.toolName, arguments: JSON.stringify(part.input) } }]
            : [],
        );
        const content = textOf(message.content);
        return [{ id, role: "assistant", content: content || undefined, toolCalls: toolCalls.length ? toolCalls : undefined }];
      }
      case "tool":
        return message.content.flatMap((part, position) =>
          part.type === "tool-result"
            ? [{ id: `${id}-${position}`, role: "tool" as const, toolCallId: part.toolCallId, content: stringify(outputValue(part.output)) }]
            : [],
        );
    }
  });
}

/** An AG-UI run's input messages as AI SDK model messages, adjacent tool results merged into one message. */
export function fromAgUiMessages(messages: AgUiMessage[]): ModelMessage[] {
  const toolNames = new Map<string, string>();
  const out: ModelMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "developer":
      case "system":
        out.push({ role: "system", content: message.content });
        break;
      case "user":
        out.push({
          role: "user",
          content:
            typeof message.content === "string"
              ? message.content
              : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        });
        break;
      case "assistant": {
        const calls = (message.toolCalls ?? []).map((call) => {
          toolNames.set(call.id, call.function.name);
          return { type: "tool-call" as const, toolCallId: call.id, toolName: call.function.name, input: parseJson(call.function.arguments) };
        });
        const content = [...(message.content ? [{ type: "text" as const, text: message.content }] : []), ...calls];
        if (content.length) out.push({ role: "assistant", content });
        break;
      }
      case "tool": {
        const result: ToolResultPart = {
          type: "tool-result",
          toolCallId: message.toolCallId,
          toolName: toolNames.get(message.toolCallId) ?? "unknown",
          output: { type: "text", value: message.content },
        };
        const previous = out.at(-1);
        if (previous?.role === "tool") previous.content.push(result);
        else out.push({ role: "tool", content: [result] });
        break;
      }
    }
  }
  return out;
}

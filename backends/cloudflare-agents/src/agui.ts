/**
 * AG-UI over SSE, from an AI SDK stream.
 *
 * pydantic-ai ships this as `AGUIAdapter`; here it is a switch statement,
 * because AG-UI's events map onto the AI SDK's `fullStream` parts one to one.
 */

import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import type { Run } from "./agent";

const stringify = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

export function agUiResponse(input: RunAgentInput, result: Run): Response {
  const encoder = new EventEncoder();
  const bytes = new TextEncoder();
  const run = { threadId: input.threadId, runId: input.runId };
  let parentMessageId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: { type: EventType } & Record<string, unknown>) =>
        controller.enqueue(bytes.encode(encoder.encodeSSE({ ...event, timestamp: Date.now() } as BaseEvent)));

      send({ type: EventType.RUN_STARTED, ...run });
      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "start-step":
              parentMessageId = crypto.randomUUID();
              break;
            case "tool-input-start":
              send({ type: EventType.TOOL_CALL_START, toolCallId: part.id, toolCallName: part.toolName, parentMessageId });
              break;
            case "tool-input-delta":
              send({ type: EventType.TOOL_CALL_ARGS, toolCallId: part.id, delta: part.delta });
              break;
            case "tool-input-end":
              send({ type: EventType.TOOL_CALL_END, toolCallId: part.id });
              break;
            case "tool-result":
              send({
                type: EventType.TOOL_CALL_RESULT,
                messageId: crypto.randomUUID(),
                toolCallId: part.toolCallId,
                content: stringify(part.output),
                role: "tool",
              });
              break;
            case "text-start":
              send({ type: EventType.TEXT_MESSAGE_START, messageId: part.id, role: "assistant" });
              break;
            case "text-delta":
              if (part.text) send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: part.id, delta: part.text });
              break;
            case "text-end":
              send({ type: EventType.TEXT_MESSAGE_END, messageId: part.id });
              break;
            case "error":
              send({ type: EventType.RUN_ERROR, message: String(part.error) });
              break;
          }
        }
        send({ type: EventType.RUN_FINISHED, ...run, outcome: { type: "success" } });
      } catch (error) {
        send({ type: EventType.RUN_ERROR, message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

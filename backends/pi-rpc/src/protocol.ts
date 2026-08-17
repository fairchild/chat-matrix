/**
 * What a wire protocol has to provide, and the run loop that drives one.
 *
 * pydantic-ai ships `VercelAIAdapter` and `AGUIAdapter`; pi ships neither, so
 * this backend carries its own. Each protocol translates the pi child's events
 * into its chunks on the way out, and pi's stored messages into its message
 * shape for rehydration.
 *
 * The events are pi's JSON wire shape: `AgentSessionEvent` with the cumulative
 * `partial` snapshot stripped from `message_update`. That one omission is what
 * makes these adapters differ from the in-process cell's — see the tool-call
 * handling in `vercel.ts` and `agui.ts`.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";

import type { PiChild, PiEvent } from "./pi.ts";

export type Chunk = Record<string, unknown>;

export interface Protocol {
  headers: Record<string, string>;
  begin(): Chunk[];
  event(event: PiEvent): Chunk[];
  end(): Chunk[];
  fail(message: string): Chunk[];
  /** Sent after the last chunk; the AI SDK wants `[DONE]`, AG-UI wants nothing. */
  trailer?: string;
  dump(threadId: string, messages: AgentMessage[]): unknown[];
}

export type Turn = { text: string; images: ImageContent[] };

const frame = (chunk: Chunk) => `data: ${JSON.stringify(chunk)}\n\n`;

/**
 * Run one turn on a thread's pi child and stream it in the protocol's shape.
 *
 * The turn is over when pi says `agent_settled` — not `agent_end`, which a
 * retry or a queued follow-up can still follow. pi appends each entry to the
 * session file as it happens, so there is nothing to persist here. A client
 * that goes away mid-run sends pi `abort`; the child settles, records the
 * partial assistant message as aborted, and stays warm for the next turn.
 */
export function streamTurn(
  child: PiChild,
  turn: Turn,
  protocol: Protocol,
  onSettled: () => void = () => {},
): Response {
  const encoder = new TextEncoder();
  let open = true;
  let settled = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunks: Chunk[]) => {
        if (!open) return;
        for (const chunk of chunks) controller.enqueue(encoder.encode(frame(chunk)));
      };
      const close = () => {
        if (!open) return;
        open = false;
        if (protocol.trailer) controller.enqueue(encoder.encode(protocol.trailer));
        controller.close();
      };
      const finish = (chunks: Chunk[]) => {
        if (settled) return;
        settled = true;
        send(chunks);
        unsubscribe();
        onSettled();
        close();
      };

      send(protocol.begin());
      const unsubscribe = child.subscribe((event) => {
        send(protocol.event(event));
        if (event.type === "agent_settled") finish(protocol.end());
      });

      // `prompt` resolves when pi accepts the turn; failures after that arrive as events.
      child.prompt(turn.text, turn.images).catch((error: Error) => finish(protocol.fail(error.message)));
      void child.exited.then((error) => finish(protocol.fail(error.message)));
    },
    // The client went away: stop the run; `agent_settled` still arrives and cleans up.
    cancel() {
      open = false;
      void child.abort();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...protocol.headers,
    },
  });
}

/** Text of a tool result: the structured `details` when a tool set them, else its text content. */
export function toolOutput(result: { content?: { type: string; text?: string }[]; details?: unknown }): unknown {
  if (result.details !== undefined && result.details !== null) return result.details;
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

export const userText = (content: AgentMessage & { role: "user" }): string =>
  typeof content.content === "string"
    ? content.content
    : content.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join(" ");

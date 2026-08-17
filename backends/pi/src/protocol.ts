/**
 * What a wire protocol has to provide, and the run loop that drives one.
 *
 * pydantic-ai ships `VercelAIAdapter` and `AGUIAdapter`; pi ships neither, so
 * this backend carries its own. Each protocol translates pi's session events
 * into its chunks on the way out, and pi's stored messages into its message
 * shape for rehydration.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";

export type Chunk = Record<string, unknown>;

export interface Protocol {
  headers: Record<string, string>;
  begin(): Chunk[];
  event(event: AgentSessionEvent): Chunk[];
  end(): Chunk[];
  fail(message: string): Chunk[];
  /** Sent after the last chunk; the AI SDK wants `[DONE]`, AG-UI wants nothing. */
  trailer?: string;
  dump(threadId: string, messages: AgentMessage[]): unknown[];
}

export type Turn = { text: string; images: ImageContent[] };

const frame = (chunk: Chunk) => `data: ${JSON.stringify(chunk)}\n\n`;

/**
 * Run one turn on a session and stream it in the protocol's shape.
 *
 * pi writes each entry to the session file as it happens, so unlike a
 * save-on-complete store there is nothing to do at the end except close.
 * A client that goes away mid-run aborts the session; whatever had already
 * happened is on disk.
 */
export function streamTurn(
  session: AgentSession,
  turn: Turn,
  protocol: Protocol,
  onSettled: () => void = () => {},
): Response {
  const encoder = new TextEncoder();
  let open = true;

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

      send(protocol.begin());
      const unsubscribe = session.subscribe((event) => send(protocol.event(event)));

      void (async () => {
        try {
          await session.prompt(turn.text, { images: turn.images });
          send(protocol.end());
        } catch (error) {
          send(protocol.fail(error instanceof Error ? error.message : String(error)));
        } finally {
          unsubscribe();
          session.dispose();
          onSettled();
          close();
        }
      })();
    },
    // The client went away: stop the run; the promise above settles and cleans up.
    cancel() {
      open = false;
      void session.abort();
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

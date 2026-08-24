"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { SessionView } from "@fairchild/folio";

import { useBackend, useHealth } from "@/lib/backend";
import { toSessionView } from "@/lib/folio-projection";
import type { ChatUIMessage } from "@/lib/messages";

/** The probe prompts, one per axis. Folio has no suggestions component and this
 *  cell does not invent one, so they arrive as the empty note's hint. */
const PROMPTS = [
  "What's the weather in Tokyo?",
  "Search notes for streaming protocols.",
  "Analyze assistant-ui as a chat frontend.",
];

export function Session() {
  // Swapping backends is this one URL. There is no model picker here even
  // though Folio's status line offers one: the model is the harness's control
  // variable, chosen once per backend at the hub, not per cell.
  const backend = useBackend();
  const { health } = useHealth(backend);
  const transport = React.useMemo(
    () => new DefaultChatTransport<ChatUIMessage>({ api: `${backend}/chat` }),
    [backend]
  );
  const { id, messages, sendMessage, status, stop, error } =
    useChat<ChatUIMessage>({ transport });

  const busy = status === "submitted" || status === "streaming";

  // The receipt's duration. The stream carries no usage and no timing, so the
  // only honest figure is the one the client watched itself: send to finish,
  // banked against the assistant message the turn produced.
  const startedAt = React.useRef<number | null>(null);
  const [turnMs, setTurnMs] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    if (busy) {
      startedAt.current ??= Date.now();
      return;
    }
    const began = startedAt.current;
    startedAt.current = null;
    const last = messages.at(-1);
    if (began === null || last?.role !== "assistant") return;
    setTurnMs((prev) => ({ ...prev, [last.id]: Date.now() - began }));
  }, [busy, messages]);

  const actions = React.useMemo(
    () => ({
      send: (text: string) => void sendMessage({ text }),
      // Stopping an idle turn is not a capability, and Folio reads an absent
      // callback as exactly that — so the ■ appears beside Send for the length
      // of a turn and is gone the rest of the time.
      ...(busy ? { stopTurn: () => stop() } : {}),
      retry: (_messageId: string, text: string) => void sendMessage({ text }),
    }),
    [sendMessage, stop, busy]
  );

  return (
    <SessionView
      // useChat mints an id per mount and this cell does not rehydrate, so the
      // key changes exactly when the thread does.
      key={id}
      turnFollowScopeId="folio-cell"
      session={toSessionView({
        messages,
        health,
        status,
        turnMs,
        emptyHint: PROMPTS.join("   ·   "),
        error,
      })}
      actions={actions}
      retryDisabled={busy}
    />
  );
}

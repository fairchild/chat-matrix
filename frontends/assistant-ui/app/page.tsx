"use client";

import { Thread } from "@/components/assistant-ui/thread";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  Suggestions,
  useAui,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useEffect, useMemo, useState } from "react";
import { type Health, indexHref, useBackend } from "@/lib/backend";

/** Which backend am I looking at? The whole point of the matrix is that this changes. */
function BackendBadge({ backend }: { backend: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${backend}/health`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, [backend]);

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
      <a
        href={indexHref(backend)}
        className="text-muted-foreground hover:text-foreground"
        title="Back to the matrix"
      >
        ← matrix
      </a>
      <span className="font-medium">assistant-ui</span>
      <span className="text-muted-foreground">→</span>
      {health ? (
        <>
          <span className="font-medium">{health.backend}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {health.model}
          </span>
          <span className="text-muted-foreground">
            {health.tools.join(" · ")}
          </span>
          <span className="ml-auto text-muted-foreground">
            {health.threads} stored {health.threads === 1 ? "thread" : "threads"}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">
          {error ? `backend unreachable at ${backend} (${error})` : "connecting…"}
        </span>
      )}
    </header>
  );
}

function ThreadWithSuggestions() {
  const aui = useAui();
  // One suggestion per tool, so each comparison axis is one click away.
  const config = AuiConfig({
    suggestions: Suggestions([
      {
        title: "Weather in Tokyo",
        label: "fast structured tool result",
        prompt: "What's the weather in Tokyo?",
      },
      {
        title: "Search notes",
        label: "a list worth rendering as cards",
        prompt: "Search notes for streaming protocols.",
      },
      {
        title: "Analyze assistant-ui",
        label: "a deliberately slow (~3s) call",
        prompt: "Analyze assistant-ui as a chat frontend.",
      },
    ]),
  });
  return (
    <AuiProvider extends={aui} config={config}>
      <Thread />
    </AuiProvider>
  );
}

export default function Home() {
  // Swapping backends is this one URL. No proxy route, no server-side glue.
  const backend = useBackend();
  const transport = useMemo(
    () => new AssistantChatTransport({ api: `${backend}/chat` }),
    [backend],
  );
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full flex-col">
        <BackendBadge backend={backend} />
        <div className="min-h-0 flex-1">
          <ThreadWithSuggestions />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}

"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import { type Health, useBackend, useIndexHref } from "@/lib/backend";

/** Same badge as the other cells, so all four are directly comparable. */
function BackendBadge() {
  const backend = useBackend();
  const hub = useIndexHref(backend);
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
    <header className="badge">
      <a className="badge-back" href={hub} title="Back to the matrix">
        ← matrix
      </a>
      <span className="badge-name">CopilotKit</span>
      <span className="badge-dim">→ ag-ui →</span>
      {health ? (
        <>
          <span className="badge-name">{health.backend}</span>
          <span className="badge-model">{health.model}</span>
          <span className="badge-dim">{health.tools.join(" · ")}</span>
          <span className="badge-right">
            {health.threads} stored {health.threads === 1 ? "thread" : "threads"}
          </span>
        </>
      ) : (
        <span className="badge-dim">
          {error ? `backend unreachable at ${backend} (${error})` : "connecting…"}
        </span>
      )}
    </header>
  );
}

export default function Home() {
  return (
    <div className="shell">
      <BackendBadge />
      <div className="chat">
        <CopilotChat
          labels={{
            welcomeMessageText:
              "Ask about the weather in Tokyo, search notes for streaming, or analyze assistant-ui — one prompt per tool.",
            chatInputPlaceholder: "Send a message…",
          }}
        />
      </div>
    </div>
  );
}

"use client"

import * as React from "react"

import { type Health, indexHref, useBackend } from "@/lib/backend"
import { NewChatButton } from "@/components/new-chat-button"

/** Same badge as the other cells, so all four are directly comparable. */
export function SiteHeader() {
  const backend = useBackend()
  const [health, setHealth] = React.useState<Health | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetch(`${backend}/health`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))
      )
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [backend])

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
      <a
        href={indexHref(backend)}
        className="text-muted-foreground hover:text-foreground"
        title="Back to the matrix"
      >
        ← matrix
      </a>
      <span className="font-medium">shadcn</span>
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
            {health.threads} stored{" "}
            {health.threads === 1 ? "thread" : "threads"}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">
          {error
            ? `backend unreachable at ${backend} (${error})`
            : "connecting…"}
        </span>
      )}
      <NewChatButton />
    </header>
  )
}

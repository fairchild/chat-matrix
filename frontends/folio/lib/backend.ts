"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8001";

export const INDEX_URL =
  process.env.NEXT_PUBLIC_INDEX_URL ?? "http://localhost:3000";

export type Health = {
  backend: string;
  model: string;
  tools: string[];
  threads: number;
  /** Which side owns the thread — see protocol/CONTRACT.md. */
  history: "client" | "session";
};

/**
 * The backend axis, as a URL.
 *
 * `?backend=…` wins over the env default so the index hub can point this cell at
 * any backend without a restart — that is what makes the matrix a matrix rather
 * than a fixed pairing. Resolved once per mount, because swapping the transport
 * mid-conversation would reset the thread.
 */
export function useBackend(): string {
  return useMemo(() => {
    if (typeof window === "undefined") return DEFAULT_BACKEND;
    const param = new URLSearchParams(window.location.search).get("backend");
    return param || DEFAULT_BACKEND;
  }, []);
}

/** Keep the chosen backend when navigating back to the hub. */
export function indexHref(backend: string): string {
  return backend === DEFAULT_BACKEND
    ? INDEX_URL
    : `${INDEX_URL}?backend=${encodeURIComponent(backend)}`;
}

/**
 * The hub link as an attribute. The server renders it for the default backend
 * (there is no query string to read there), and hydration leaves attributes as
 * the server wrote them, so the real value has to arrive as an update.
 */
export function useIndexHref(backend: string): string {
  const [href, setHref] = useState(INDEX_URL);
  useEffect(() => setHref(indexHref(backend)), [backend]);
  return href;
}

/**
 * `/health`, which is the only thing this cell knows about the backend beyond
 * the stream. Folio's masthead and status line are filled from it and from
 * nothing else — a figure the host does not know is a figure the receipt does
 * not show.
 */
export function useHealth(backend: string): {
  health: Health | null;
  error: string | null;
} {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${backend}/health`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))
      )
      .then((body: Health) => live && setHealth(body))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [backend]);

  return { health, error };
}

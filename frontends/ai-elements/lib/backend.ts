"use client";

import { useMemo } from "react";

const DEFAULT_BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8001";

export const INDEX_URL =
  process.env.NEXT_PUBLIC_INDEX_URL ?? "http://localhost:3000";

export type Health = {
  backend: string;
  model: string;
  tools: string[];
  threads: number;
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

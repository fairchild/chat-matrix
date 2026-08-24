"use client";

import * as React from "react";

import { useBackend, useHealth, useIndexHref } from "@/lib/backend";

/**
 * The only chrome this cell adds. The other cells put the model, the tool list
 * and a thread count in their header; here those facts belong to Folio's own
 * masthead and status line, so the bar keeps the two the surface can't know —
 * which cell of the matrix this is, and the way back to the hub.
 *
 * Its height is `--folio-chrome-top` in globals.css. Folio's masthead sticks
 * below whatever the host stacks above it, and turn follow measures the stack,
 * so the number has to be right or the page docks a turn under this bar.
 */
export function HostBar() {
  const backend = useBackend();
  const hub = useIndexHref(backend);
  const { health, error } = useHealth(backend);

  return (
    <div className="host-bar">
      <a href={hub} title="Back to the matrix">
        ← matrix
      </a>
      <span className="host-bar-cell">folio</span>
      {health ? (
        <>
          <span className="host-bar-sep">×</span>
          <span className="host-bar-cell">{health.backend}</span>
        </>
      ) : (
        <span className="host-bar-quiet">
          {error ? `backend unreachable at ${backend} (${error})` : "connecting…"}
        </span>
      )}
    </div>
  );
}

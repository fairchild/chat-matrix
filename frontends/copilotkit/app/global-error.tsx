"use client";

/**
 * Next 16 renamed this boundary's second prop from `reset` to `retry`.
 *
 * Note the production build currently fails while prerendering `/_global-error`
 * with a null `useContext` — supplying this file does not fix that, and the
 * assistant-ui frontend fails identically, so it's a Next 16 issue rather than
 * anything to do with CopilotKit. Both apps run fine under `next dev`.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: 24 }}>
        <h2>Something went wrong</h2>
        <p style={{ color: "#71717a", fontSize: 14 }}>{error.message}</p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  );
}

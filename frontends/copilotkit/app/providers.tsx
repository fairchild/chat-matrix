"use client";

import { CopilotKit, WildcardToolCallRender } from "@copilotkit/react-core/v2";
import { useBackend } from "@/lib/backend";

/**
 * A client component because `renderToolCalls` takes React components, which
 * can't cross the server/client boundary as props from a server layout.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const backend = useBackend();

  return (
    <CopilotKit
      // This app's own runtime route, not the Python backend — see app/api/copilotkit.
      runtimeUrl="/api/copilotkit"
      // Matches the key in the runtime's `agents` map.
      agent="demo"
      // The runtime hop runs server-side, so the chosen backend has to travel as
      // a header for the route's agents factory to pick it up.
      headers={{ "x-demo-backend": backend }}
      // Without this, tool calls render as nothing at all: CopilotKit has no
      // default renderer for unknown tools, so you opt into the wildcard one.
      renderToolCalls={[WildcardToolCallRender]}
      // Otherwise the inspector and its product announcements overlay the app.
      showDevConsole={false}
    >
      {children}
    </CopilotKit>
  );
}

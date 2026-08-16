"use client";

import { CopilotKit, WildcardToolCallRender } from "@copilotkit/react-core/v2";

/**
 * A client component because `renderToolCalls` takes React components, which
 * can't cross the server/client boundary as props from a server layout.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      // This app's own runtime route, not the Python backend — see app/api/copilotkit.
      runtimeUrl="/api/copilotkit"
      // Matches the key in the runtime's `agents` map.
      agent="demo"
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

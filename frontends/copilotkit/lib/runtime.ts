/**
 * CopilotKit's server-side runtime, as one function so the Next route (local,
 * `next dev`) and the hosted Worker (`worker/index.ts`) build the same thing.
 *
 * `CopilotRuntime` takes a per-request agents factory, so the browser sends its
 * chosen backend as a header and the factory builds the `HttpAgent` for it.
 */
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotHonoHandler } from "@copilotkit/runtime/v2";

/** Only ever talk to a local harness backend, whatever the header claims. */
export function safeBackend(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return local && url.protocol === "http:" ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

export function createRuntimeApp(defaultBackend: string) {
  const runtime = new CopilotRuntime({
    agents: ({ request }) => {
      const backend = safeBackend(request.headers.get("x-demo-backend"), defaultBackend);
      return { demo: new HttpAgent({ url: `${backend}/ag-ui` }) };
    },
  });
  return createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit", mode: "single-route" });
}

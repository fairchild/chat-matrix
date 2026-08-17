/**
 * CopilotKit needs a server-side runtime between the browser and the agent.
 *
 * This is the structural difference from the direct cells, and it shows up again
 * in backend switching: the other three read `?backend=` in the browser, but here
 * the hop that talks to the backend runs on the server, so the choice has to be
 * forwarded. `CopilotRuntime` takes a per-request agents factory, so the browser
 * sends the backend as a header and the factory builds the `HttpAgent` for it.
 */
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotHonoHandler } from "@copilotkit/runtime/v2";

// Server-side default, so no NEXT_PUBLIC_ prefix — this hop never runs in the browser.
const DEFAULT_BACKEND = process.env.BACKEND_URL ?? "http://localhost:8001";

/** Only ever talk to a local harness backend, whatever the header claims. */
function safeBackend(raw: string | null): string {
  if (!raw) return DEFAULT_BACKEND;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return local && url.protocol === "http:" ? url.origin : DEFAULT_BACKEND;
  } catch {
    return DEFAULT_BACKEND;
  }
}

const runtime = new CopilotRuntime({
  agents: ({ request }) => {
    const backend = safeBackend(request.headers.get("x-demo-backend"));
    return { demo: new HttpAgent({ url: `${backend}/ag-ui` }) };
  },
});

const app = createCopilotHonoHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;

/**
 * CopilotKit needs a server-side runtime between the browser and the agent.
 *
 * This is the structural difference from assistant-ui, which talks to the
 * backend directly: here the browser speaks CopilotKit's own protocol to this
 * route, and the route speaks AG-UI to the Python backend. `HttpAgent` is the
 * AG-UI client doing that second hop.
 */
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotHonoHandler } from "@copilotkit/runtime/v2";

// Server-side, so no NEXT_PUBLIC_ prefix — this hop never runs in the browser.
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8001";

const runtime = new CopilotRuntime({
  agents: {
    demo: new HttpAgent({ url: `${BACKEND}/ag-ui` }),
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

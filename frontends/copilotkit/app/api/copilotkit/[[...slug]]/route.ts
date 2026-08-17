/**
 * CopilotKit needs a server-side runtime between the browser and the agent.
 *
 * This is the structural difference from the direct cells, and it shows up again
 * in backend switching: the other three read `?backend=` in the browser, but here
 * the hop that talks to the backend runs on the server, so the choice has to be
 * forwarded — see lib/runtime.ts, which the hosted Worker shares.
 */
import { createRuntimeApp } from "@/lib/runtime";

// Server-side default, so no NEXT_PUBLIC_ prefix — this hop never runs in the browser.
const app = createRuntimeApp(process.env.BACKEND_URL ?? "http://localhost:8001");

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;

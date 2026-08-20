/**
 * HTTP surface: the reference contract (`protocol/CONTRACT.md`) on Cloudflare
 * Workers, with the Agents SDK underneath.
 *
 * The Worker only routes. Each thread is an Agent — a Durable Object named by
 * thread id — and `/chat` and `/ag-ui` stream from inside it; `/threads` reads
 * a singleton Registry Agent that indexes them.
 */

import { BACKEND_NAME, SDK_VERSION, TOOL_NAMES } from "./agent";
import { toAgUiMessages, toUIMessages } from "./messages";
import { catalogue, unavailable } from "./models";
import { Registry, registryStub } from "./registry";
import { Thread, threadStub } from "./thread";

export { Registry, Thread };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "*",
  "access-control-allow-headers": "*",
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const notFound = (detail: string): Response => json({ detail }, 404);

/**
 * Two routes that are free on a laptop and not free on the open internet: the
 * bulk thread list, which is every visitor's first message, and the model
 * switch, which mutates what every visitor's next turn runs on. Both are bound
 * to a var rather than removed, because the local matrix needs them — the
 * conformance gate reads `/threads`, and the hub's picker is the model axis.
 *
 * The default is the locked one on purpose. `wrangler deploy` from this
 * directory reads the committed config and nothing else, so anything that has
 * to be remembered at deploy time is a thing that eventually isn't. `bun run
 * dev` carries the unlock instead, where forgetting it fails a local gate you
 * are already looking at. The pi backends make the same call one layer down,
 * binding to loopback because `POST /model` can reach a stored credential.
 */
const unlocked = (value: string | undefined): boolean => value === "1";

const THREAD_LIST_LOCKED =
  "the bulk thread list is off on this deployment — GET /threads/{id} still serves a thread whose id you hold";
const MODEL_SWITCH_LOCKED =
  "the model is fixed on this deployment — a local clone runs the same backend with the switch open";

const RENDERERS = { "vercel-ai": toUIMessages, "ag-ui": toAgUiMessages } as const;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const registry = await registryStub(env);
  const threadMatch = /^\/threads\/([^/]+)$/.exec(url.pathname);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      backend: BACKEND_NAME,
      model: await registry.model(),
      protocols: { "vercel-ai": `/chat (sdk v${SDK_VERSION})`, "ag-ui": "/ag-ui" },
      tools: TOOL_NAMES,
      threads: await registry.count(),
      history: "client",
    });
  }

  /**
   * Every model this backend knows about, available or not, each with its
   * reason — and whether the switch itself is open, which is a separate claim
   * from any one model's availability. A client that only reads `models` still
   * works; the hub reads `locked` and draws a readout instead of a control.
   */
  if (request.method === "GET" && url.pathname === "/models") {
    const current = await registry.model();
    const locked = !unlocked(env.PUBLIC_MODEL_SWITCH);
    return json({ current, locked, why: locked ? MODEL_SWITCH_LOCKED : null, models: catalogue(env, current) });
  }

  /** Switch the running model. Backend-wide on purpose: the model is the control variable. */
  if (request.method === "POST" && url.pathname === "/model") {
    if (!unlocked(env.PUBLIC_MODEL_SWITCH)) return json({ detail: MODEL_SWITCH_LOCKED }, 403);
    const { id } = (await request.json()) as { id?: unknown };
    if (typeof id !== "string") return json({ detail: 'body must be {"id": "…"}' }, 400);
    const reason = unavailable(env, id);
    if (reason) return json({ detail: reason }, 400);
    await registry.setModel(id);
    return json({ model: id });
  }

  if (request.method === "POST" && (url.pathname === "/chat" || url.pathname === "/ag-ui")) {
    const body = await request.text();
    const parsed = JSON.parse(body) as { id?: unknown; threadId?: unknown };
    const threadId = url.pathname === "/chat" ? parsed.id : parsed.threadId;
    if (typeof threadId !== "string" || !threadId) return json({ detail: "thread id required" }, 400);
    const thread = await threadStub(env, threadId);
    return thread.fetch(new Request(url, { method: "POST", body, headers: { "content-type": "application/json" } }));
  }

  if (request.method === "GET" && url.pathname === "/threads") {
    // Empty rather than 404, and carrying why: "no threads yet" and "this
    // deployment doesn't publish them" are different facts and a caller
    // reading a bare `[]` can't tell them apart. `/health` still reports the
    // count — it's the titles that are the exposure, not the number.
    if (!unlocked(env.PUBLIC_THREAD_LIST)) return json({ threads: [], detail: THREAD_LIST_LOCKED });
    return json({ threads: await registry.list() });
  }

  if (threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);
    const thread = await threadStub(env, threadId);

    if (request.method === "GET") {
      const protocol = url.searchParams.get("protocol") ?? "vercel-ai";
      if (!(protocol in RENDERERS)) return json({ detail: `protocol must be one of ${JSON.stringify(Object.keys(RENDERERS))}` }, 400);
      const messages = await thread.history();
      if (!messages) return notFound(`no thread ${JSON.stringify(threadId)}`);
      return json({ id: threadId, protocol, messages: RENDERERS[protocol as keyof typeof RENDERERS](messages) });
    }

    if (request.method === "DELETE") {
      const removed = await thread.remove();
      await registry.remove(threadId);
      return removed ? json({ deleted: true }) : notFound(`no thread ${JSON.stringify(threadId)}`);
    }
  }

  return notFound("not found");
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const response = await route(request, env);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;

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

  /** Every model this backend knows about, available or not, each with its reason. */
  if (request.method === "GET" && url.pathname === "/models") {
    const current = await registry.model();
    return json({ current, models: catalogue(env, current) });
  }

  /** Switch the running model. Backend-wide on purpose: the model is the control variable. */
  if (request.method === "POST" && url.pathname === "/model") {
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

/**
 * HTTP surface: the same pi agent served over two protocols, plus thread
 * management. Same six routes as every backend — see protocol/CONTRACT.md.
 */

import { BACKEND_NAME, currentModel, models, MODEL_SPEC, openSession, TOOL_NAMES, useModel } from "./agent.ts";
import { aguiProtocol, turnFromRun, type RunAgentInput } from "./agui.ts";
import { streamTurn, type Protocol, type Turn } from "./protocol.ts";
import { ThreadStore } from "./store.ts";
import { turnFromChat, vercelProtocol, type ChatRequest } from "./vercel.ts";

const PORT = Number(process.env.PORT ?? 8003);
const store = new ThreadStore(process.env.DEMO_SESSIONS ?? "data/sessions");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...CORS } });

const problem = (status: number, detail: string) => json({ detail }, status);

/** One turn at a time per thread: pi sessions are append-only files, and two writers would interleave. */
const running = new Set<string>();

async function runTurn(threadId: string, turn: Turn, protocol: Protocol): Promise<Response> {
  if (running.has(threadId)) return problem(409, `thread ${JSON.stringify(threadId)} is already running a turn`);
  running.add(threadId);
  try {
    const session = await openSession(store.open(threadId));
    const response = streamTurn(session, turn, protocol, () => running.delete(threadId));
    return new Response(response.body, { headers: { ...Object.fromEntries(response.headers), ...CORS } });
  } catch (error) {
    running.delete(threadId);
    return problem(500, error instanceof Error ? error.message : String(error));
  }
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (request.method === "GET" && path === "/health") {
    return json({
      backend: BACKEND_NAME,
      model: currentModel(),
      protocols: { "vercel-ai": "/chat (sdk v7)", "ag-ui": "/ag-ui" },
      tools: TOOL_NAMES,
      threads: (await store.list()).length,
      history: "session",
    });
  }

  /** Every model this backend knows about, available or not, each with its reason. */
  if (request.method === "GET" && path === "/models") {
    return json({ current: currentModel(), models: models() });
  }

  /** Switch the running model. Process-wide on purpose: the model is the control variable. */
  if (request.method === "POST" && path === "/model") {
    const { id } = (await request.json()) as { id?: unknown };
    if (typeof id !== "string") return problem(400, "body must be {\"id\": \"…\"}");
    try {
      useModel(id);
    } catch (error) {
      return problem(400, error instanceof Error ? error.message : String(error));
    }
    return json({ model: currentModel() });
  }

  if (request.method === "POST" && path === "/chat") {
    const body = (await request.json()) as ChatRequest;
    const threadId = body.id ?? crypto.randomUUID();
    return runTurn(threadId, turnFromChat(body), vercelProtocol());
  }

  if (request.method === "POST" && path === "/ag-ui") {
    const body = (await request.json()) as RunAgentInput;
    const threadId = body.threadId ?? crypto.randomUUID();
    const runId = body.runId ?? crypto.randomUUID();
    return runTurn(threadId, turnFromRun(body), aguiProtocol(threadId, runId));
  }

  if (request.method === "GET" && path === "/threads") {
    return json({ threads: await store.list() });
  }

  const thread = /^\/threads\/([^/]+)$/.exec(path);
  if (thread) {
    const threadId = decodeURIComponent(thread[1]!);
    if (request.method === "GET") {
      if (!store.exists(threadId)) return problem(404, `no thread ${JSON.stringify(threadId)}`);
      const name = url.searchParams.get("protocol") ?? "vercel-ai";
      const protocols: Record<string, () => Protocol> = {
        "vercel-ai": vercelProtocol,
        "ag-ui": () => aguiProtocol(threadId, "hydrate"),
      };
      const protocol = protocols[name];
      if (!protocol) return problem(400, `protocol must be one of ${JSON.stringify(Object.keys(protocols).sort())}`);
      return json({ id: threadId, protocol: name, messages: protocol().dump(threadId, store.history(threadId)) });
    }
    if (request.method === "DELETE") {
      if (!store.delete(threadId)) return problem(404, `no thread ${JSON.stringify(threadId)}`);
      return json({ deleted: true });
    }
  }

  return problem(404, `no route ${request.method} ${path}`);
}

Bun.serve({
  port: PORT,
  // Loopback by default. `Bun.serve` binds 0.0.0.0 unless told otherwise, and
  // since `POST /model` can now reach a credential `pi auth login` stored — one
  // no env var ever exposed — an open port would hand that session to anyone on
  // the network. uvicorn and the index already default to localhost; this makes
  // the pi cells agree, and a LAN demo an explicit DEMO_HOST=0.0.0.0.
  hostname: process.env.DEMO_HOST ?? "127.0.0.1",
  idleTimeout: 120,
  fetch: (request) =>
    handle(request).catch((error) =>
      problem(500, error instanceof Error ? error.message : String(error)),
    ),
});

console.log(`chat-stack backend · ${BACKEND_NAME} · model=${MODEL_SPEC} · http://localhost:${PORT}`);

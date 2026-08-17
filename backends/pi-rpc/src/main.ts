/**
 * HTTP surface: the same pi agent served over two protocols, plus thread
 * management. Same six routes as every backend — see protocol/CONTRACT.md.
 */

import { aguiProtocol, turnFromRun, type RunAgentInput } from "./agui.ts";
import { childArgs, PiChild, Pool } from "./pi.ts";
import { streamTurn, type Protocol, type Turn } from "./protocol.ts";
import { sessionIdFor, ThreadStore } from "./store.ts";
import { TOOL_NAMES } from "./tools.ts";
import { turnFromChat, vercelProtocol, type ChatRequest } from "./vercel.ts";

export const BACKEND_NAME = "pi-rpc";
export const MODEL_SPEC = process.env.DEMO_MODEL ?? "scripted";

const PORT = Number(process.env.PORT ?? 8004);
const store = new ThreadStore(process.env.DEMO_SESSIONS ?? "data/sessions");
const pool = new Pool({
  model: MODEL_SPEC,
  sessionDir: store.dir,
  idleMs: Number(process.env.DEMO_IDLE_SECONDS ?? 60) * 1000,
  max: Number(process.env.DEMO_MAX_CHILDREN ?? 4),
});

/** `scripted` is the extension's provider; anything else is pi's `provider/model[:thinking]`. */
const model = MODEL_SPEC === "scripted" ? "scripted/scripted" : MODEL_SPEC;

/** Fail at boot, not on the first message: ask a throwaway child what `--model` resolved to. */
async function checkModel() {
  const child = new PiChild("_probe", [...childArgs({ model, sessionDir: store.dir, sessionId: "probe" }), "--no-session"]);
  try {
    const state = await child.request({ type: "get_state" });
    const resolved = (state as { data?: { model?: { provider: string; id: string } } }).data?.model;
    if (!resolved) throw new Error(`no model resolved for ${MODEL_SPEC}`);
  } catch (error) {
    console.error(
      `DEMO_MODEL=${MODEL_SPEC}: ${error instanceof Error ? error.message : String(error)}\n` +
        "pi spells models provider/model[:thinking], e.g. anthropic/claude-opus-4-5; `pi --list-models` lists them.",
    );
    process.exit(1);
  } finally {
    child.kill();
  }
}
await checkModel();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...CORS } });

const problem = (status: number, detail: string) => json({ detail }, status);

/** One turn at a time per thread: a pi child holds one session, and pi refuses a prompt while streaming. */
async function runTurn(threadId: string, turn: Turn, protocol: Protocol): Promise<Response> {
  let child: PiChild;
  try {
    child = await pool.acquire(threadId, sessionIdFor(threadId));
  } catch (error) {
    return problem(500, error instanceof Error ? error.message : String(error));
  }
  if (child.busy) return problem(409, `thread ${JSON.stringify(threadId)} is already running a turn`);
  child.busy = true;
  const response = streamTurn(child, turn, protocol, () => pool.release(child));
  return new Response(response.body, { headers: { ...Object.fromEntries(response.headers), ...CORS } });
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (request.method === "GET" && path === "/health") {
    return json({
      backend: BACKEND_NAME,
      model: MODEL_SPEC,
      protocols: { "vercel-ai": "/chat (sdk v7)", "ag-ui": "/ag-ui" },
      tools: TOOL_NAMES,
      threads: (await store.list()).length,
      children: pool.size,
    });
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
      // The child goes first: a live one would keep appending to a file that no longer exists.
      pool.evict(threadId);
      if (!store.delete(threadId)) return problem(404, `no thread ${JSON.stringify(threadId)}`);
      return json({ deleted: true });
    }
  }

  return problem(404, `no route ${request.method} ${path}`);
}

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  fetch: (request) =>
    handle(request).catch((error) =>
      problem(500, error instanceof Error ? error.message : String(error)),
    ),
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    pool.killAll();
    process.exit(0);
  });

console.log(`chat-stack backend · ${BACKEND_NAME} · model=${MODEL_SPEC} · http://localhost:${PORT}`);

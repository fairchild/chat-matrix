/**
 * The hosted shape of this cell: the static export in out/ served as assets,
 * and this Worker answering /api/copilotkit — the same runtime hop the Next
 * route provides under `next dev`, on the same origin, so the app's
 * `runtimeUrl="/api/copilotkit"` holds in both. `express` and `cors` are
 * aliased to a stub in wrangler.jsonc: the runtime package imports them
 * eagerly and express does code generation at module init, which Workers
 * forbid, but the Hono path never calls into them.
 */
import { createRuntimeApp } from "../lib/runtime";

// Typed locally rather than via the Workers globals so this file also passes the
// Next app's own typecheck, which sweeps the whole directory.
type Env = { BACKEND_URL?: string; ASSETS: { fetch(request: Request): Promise<Response> } };

let app: ReturnType<typeof createRuntimeApp> | undefined;

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/copilotkit")) return env.ASSETS.fetch(request);
    app ??= createRuntimeApp(env.BACKEND_URL ?? "http://localhost:8001");
    return app.fetch(request);
  },
};

export default worker;

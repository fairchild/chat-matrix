// One adapter per frontend: the only file that knows what any stack's DOM looks
// like. Everything else in probes/ is written against this interface, which is
// what lets one flow run against three unrelated UIs.
//
// The artifact key lives here too (`backendKey`, `captureKey`): the spec, the
// runner and the gallery all have to agree about where a capture goes, and this
// is already the file that knows which cell is which.
//
// Ports are not repeated here — they come from scripts/stacks.sh, which stays the
// single place the matrix is listed. A frontend that appears there without an
// adapter below is reported as unsupported rather than silently skipped. The
// hosted subset comes from scripts/hosted.sh for the same reason: a preview run
// drives what was actually deployed, not what the matrix wishes were deployed.
//
// The selectors are transcribed from the running pages, not from the source, and
// what each stack gives you to hold on to is itself a result: CopilotKit ships
// data-testid throughout, assistant-ui and shadcn/ui ship data-slot on every
// primitive, and AI Elements ships neither, so its adapter leans on layout
// classes that a redesign would break.
//
// One exception worth naming, because it would otherwise read as a fifth result:
// shadcn's `[data-tool]` is not something the library provides. The tool cards
// are hand-written components in that cell's components/parts/, and their author
// tagged the roots so these flows could address them. Reading that attribute as
// evidence about shadcn/ui would be reading their handwriting.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");

export type Adapter = {
  /** Composer textarea. */
  composer: (page: Page) => Locator;
  /** Whatever the UI offers to interrupt a run — the cross-stack "busy" tell. */
  stop: (page: Page) => Locator;
  userMessages: (page: Page) => Locator;
  assistantMessages: (page: Page) => Locator;
  toolCalls: (page: Page) => Locator;
  /** How to find the call for a named tool. Defaults to matching the tool name
   *  as visible text, which is what three of the four do; override where the
   *  name lives somewhere else, like an attribute. */
  toolNamed?: (page: Page, tool: string) => Locator;
  /** Transcript region, for the reply-text assertions. */
  transcript: (page: Page) => Locator;
  /** Some stacks collapse tool calls by default; expanding is what makes the
   *  screenshot worth looking at. No-op where they're already open. */
  expandToolCall?: (page: Page) => Promise<void>;
  /** Declares that this cell runs its own agent in the process that serves it
   *  and ignores `?backend=`. Such a cell sits outside the backend grid: its
   *  captures are filed under its own name rather than under the backend a run
   *  targeted, because that backend never reached the page — labelling them
   *  with it would invent a variable. The gallery shows it once per moment. */
  ownAgent?: true;
  /** Declares that this cell puts the thread back on screen after a reload.
   *  The `resume` flow asserts both directions: a cell that declares it must
   *  show the messages again, and a cell that says nothing must come back
   *  empty — so the flag can't quietly absorb a regression, and a cell that
   *  starts rehydrating goes red until someone declares it here. */
  resumes?: true;
};

const ADAPTERS: Record<string, Adapter> = {
  "assistant-ui": {
    composer: (p) => p.locator('textarea[aria-label="Message input"]'),
    stop: (p) => p.locator('button[aria-label="Stop generating"]'),
    userMessages: (p) => p.locator('[data-slot="aui_user-message-root"]'),
    assistantMessages: (p) => p.locator('[data-slot="aui_assistant-message-root"]'),
    toolCalls: (p) => p.locator('[data-slot="tool-group-root"]'),
    transcript: (p) => p.locator('[data-slot="aui_thread-viewport"]'),
    // Collapsed by default: the transcript says "1 tool call" and nothing else
    // until you open it.
    expandToolCall: async (p) => {
      const trigger = p.locator('[data-slot="tool-group-trigger"]').first();
      if ((await trigger.count()) === 0) return;
      if ((await trigger.getAttribute("data-state")) === "closed") await trigger.click();
    },
  },

  copilotkit: {
    composer: (p) => p.locator('[data-testid="copilot-chat-textarea"]'),
    // No stop button anywhere; the chat container carries run state as an
    // attribute instead, which is the tidiest busy signal of the three.
    stop: (p) => p.locator('[data-testid="copilot-chat"][data-copilot-running="true"]'),
    userMessages: (p) => p.locator('[data-testid="copilot-user-message"]'),
    // A tool call arrives as its own assistant message, so this counts one
    // higher than the other two stacks do for the same turn.
    assistantMessages: (p) => p.locator('[data-testid="copilot-assistant-message"]'),
    // The tool node itself carries no testid — only a status pill reading
    // inProgress/complete — so this matches on the pill's vocabulary.
    toolCalls: (p) =>
      p
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: /inProgress|complete|executing/ }),
    transcript: (p) => p.locator('[data-testid="copilot-message-list"]'),
    // Collapsed by default. The header is a bare div, so this reaches for a
    // Tailwind class fragment — the least durable selector in the file.
    expandToolCall: async (p) => {
      const header = p
        .locator('[data-testid="copilot-assistant-message"] [class*="cursor-pointer"]')
        .first();
      if ((await header.count()) > 0) await header.click();
    },
  },

  "ai-elements": {
    composer: (p) => p.locator('textarea[name="message"]'),
    stop: (p) => p.locator('button[aria-label="Stop"]'),
    // `.is-user` is a real class token on the message root; the inner bubble
    // carries `is-user:dark`, which is a different token and doesn't collide.
    userMessages: (p) => p.locator(".is-user"),
    assistantMessages: (p) => p.locator(".is-assistant"),
    toolCalls: (p) => p.locator('.is-assistant [data-slot="collapsible"]'),
    transcript: (p) => p.locator('[role="log"]'),
    // Already open — page.tsx passes defaultOpen, which the registry's own
    // examples don't.
  },

  shadcn: {
    composer: (p) => p.locator('textarea[data-slot="input-group-control"]'),
    stop: (p) => p.locator('button[aria-label="Stop generating"]'),
    userMessages: (p) => p.locator('[data-slot="message"][data-align="end"]'),
    assistantMessages: (p) => p.locator('[data-slot="message"][data-align="start"]'),
    toolCalls: (p) => p.locator("[data-tool]"),
    // The tool name is the attribute's value, not text on screen: the weather
    // card reads "Tokyo · crisp and sunny", never "get_weather".
    toolNamed: (p, tool) => p.locator(`[data-tool="${tool}"]`),
    transcript: (p) => p.locator('[data-slot="message-scroller-viewport"]'),
    // Nothing collapses — every tool renders a bespoke component per state,
    // so there is no disclosure to open.
  },

  // Folio ships data-testid on the workings apparatus — the ledger block, its
  // rows, their bodies, the activity line — and marks each message with
  // data-message-role, so most of this is the package's own handwriting rather
  // than the cell's. Two exceptions are the cell's. `data-turn-follow-scope` is
  // the value it passes as turnFollowScopeId, a prop Folio documents as being
  // for exactly this. And the busy tell is a decision rather than a state:
  // Folio renders ■ whenever the host hands it a stopTurn callback, so a cell
  // that always passes one shows a Stop button that is never a signal. This one
  // passes it only while a turn is in flight — stopping an idle turn is not a
  // capability — which is what makes the button's presence mean something here.
  // Rows fold their bodies away until asked, hence expandToolCall; and the
  // reference agent's three tools are all outside Folio's coding-verb table, so
  // a row stands as the tool's own name and toolNamed's default finds it.
  folio: {
    composer: (p) => p.locator("[data-compose-boundary] textarea"),
    stop: (p) => p.locator('button[aria-label="Stop"]'),
    userMessages: (p) => p.locator('article[data-message-role="user"]'),
    assistantMessages: (p) => p.locator('article[data-message-role="assistant"]'),
    toolCalls: (p) => p.locator('[data-testid="tool-row"]'),
    transcript: (p) => p.locator('main[data-turn-follow-scope="folio-cell"]'),
    expandToolCall: async (p) => {
      const twist = p.locator('[data-testid="tool-row"] button[aria-expanded="false"]').first();
      if ((await twist.count()) === 0) return;
      await twist.click();
    },
  },

  // Server-rendered: every selector below is a Jinja template's handwriting,
  // written to this file's interface on purpose (frontends/jinja, plan §3.3).
  // The Stop button exists only while a run is in flight, which is the busy
  // tell; the tool name is visible text in the card header, so toolNamed's
  // default works. Nothing collapses. The thread lives in the process that
  // renders the page, so a reload re-renders it rather than starting over —
  // which is what `resumes` declares, and what the `resume` flow holds it to.
  // That same process also holds the agent, so `?backend=` never reaches it:
  // `ownAgent` says so, and keeps its captures out of the backend grid.
  jinja: {
    ownAgent: true,
    resumes: true,
    composer: (p) => p.locator('textarea[data-slot="input"]'),
    stop: (p) => p.locator('button[aria-label="Stop generating"]'),
    userMessages: (p) => p.locator('[data-role="user"]'),
    assistantMessages: (p) => p.locator('[data-role="assistant"]'),
    toolCalls: (p) => p.locator('[data-part="tool"]'),
    transcript: (p) => p.locator('[data-slot="transcript"]'),
  },
};

export type Frontend = { name: string; port: number; url: string; adapter: Adapter };

/** Why a cell the matrix names isn't being driven. `no-adapter` is a gap in this
 *  file. `not-hosted` is the hosted preview serving a subset on purpose, which
 *  is a different thing and reads differently in the report. */
export type Unsupported = { name: string; why: "no-adapter" | "not-hosted" };

const portOffset = (): number => Number(process.env.PROBE_PORT_OFFSET ?? 0);

/** An explicit base URL per cell, keyed by the names in scripts/stacks.sh plus
 *  `index` for the hub: `{"assistant-ui": "https://…", "index": "https://…"}`.
 *  Everything else here derives a URL from a port, which can only ever address
 *  this machine — this is the one way to drive a matrix that is somewhere else,
 *  and scripts/probe.sh --production fills it from scripts/hosted.sh so the
 *  deployed URLs are still read from the topology rather than typed twice. */
const bases = (): Record<string, string> => {
  const raw = process.env.PROBE_BASES?.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`probes: PROBE_BASES is not JSON — got ${raw.slice(0, 60)}`);
  }
};

/** Whether this run is driving somewhere other than this machine's ports. */
export const isRemote = (): boolean => Object.keys(bases()).length > 0;

/** The suffix backendKey() appends for a run against explicit bases, for the
 *  same reason preview gets one: the deployed build and the local one are two
 *  things to compare, not one thing run twice. */
export const REMOTE_SUFFIX = "-deployed";

/** Whether this run is driving the hosted preview rather than the local
 *  matrix — scripts/preview.sh's static exports at port+offset, as opposed to
 *  scripts/run.sh's dev servers. Defined once here so backendKey() and the
 *  gallery agree about what a preview run is. */
export const isPreview = (): boolean => portOffset() !== 0;

/** The suffix backendKey() appends for a preview run. Exported so the gallery
 *  can recognise a preview key without re-deriving the rule. */
export const PREVIEW_SUFFIX = "-preview";

/** `PROBE_BACKEND=http://localhost:8002` drives every cell against that backend
 *  instead of its default — the hub's `?backend=` carried through the open step.
 *  `PROBE_PORT_OFFSET=1000` drives the hosted preview (scripts/preview.sh),
 *  which serves each cell's static export at its port plus the offset. */
const cellUrl = (name: string, port: number): string => {
  const backend = process.env.PROBE_BACKEND;
  const base = bases()[name] ?? `http://localhost:${port + portOffset()}`;
  return backend ? `${base}/?backend=${encodeURIComponent(backend)}` : base;
};

/** The hub, at the same offset as everything else: scripts/run.sh serves it on
 *  :3000 and scripts/preview.sh on :4000, which is the same +1000 the cells
 *  move by, so one offset addresses the whole matrix. Read from run.sh rather
 *  than repeated, for the same reason the cell ports are. */
export const hubUrl = (): string => {
  const given = bases().index;
  if (given) return given;
  const run = readFileSync(join(ROOT, "scripts", "run.sh"), "utf8");
  const declared = run.match(/INDEX_PORT="\$\{INDEX_PORT:-(\d+)\}"/);
  if (!declared) throw new Error("probes: no INDEX_PORT default in scripts/run.sh");
  return `http://localhost:${Number(declared[1]) + portOffset()}`;
};

/** The hosted subset, read from scripts/hosted.sh — the same list preview.sh and
 *  publish.sh build from, so a preview run can't drive a cell that was never
 *  deployed. Only Cloudflare's subset is filtered: a local run serves the whole
 *  matrix, and jinja is a Python process rather than a static export, so it has
 *  nothing at port+offset to photograph. */
const hostedCells = (): Set<string> => {
  const hosted = readFileSync(join(ROOT, "scripts", "hosted.sh"), "utf8");
  const block = hosted.match(/HOSTED_CELLS=\(([^)]*)\)/);
  if (!block) throw new Error("probes: no HOSTED_CELLS=(…) block in scripts/hosted.sh");
  return new Set([...block[1].matchAll(/[\w-]+/g)].map((m) => m[0]));
};

const slug = (s: string): string =>
  s.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");

/** host and port, e.g. http://localhost:8002 → localhost-8002. */
const urlSlug = (url: string): string => {
  try {
    const u = new URL(url);
    return slug(u.port ? `${u.hostname}-${u.port}` : u.hostname);
  } catch {
    return slug(url);
  }
};

/** What this run's backend is called, and so the top level of the artifact
 *  layout: two runs against different backends sit side by side instead of the
 *  second overwriting the first. scripts/probe.sh resolves the name from the
 *  effective backend's /health and exports it; a bare `bunx playwright test` has
 *  no such resolution, so the URL's host-port stands in and the captures still
 *  land somewhere legible. With neither, each cell talks to whatever backend it
 *  was built against, which is all this can honestly say.
 *
 *  A preview run (isPreview()) gets PREVIEW_SUFFIX appended. The backend named
 *  above is the same one a local run would drive — PROBE_PORT_OFFSET only moves
 *  which servers hold the frontends, from run.sh's dev servers to preview.sh's
 *  static exports, the build that would actually publish. Those are two
 *  different things to look at side by side, not one thing run twice, so a
 *  preview run has to land on its own key rather than overwrite a local run
 *  against the same backend — otherwise the gallery couldn't say which build a
 *  band came from. */
export const backendKey = (): string => {
  const named = process.env.PROBE_BACKEND_NAME?.trim();
  const base = named ? slug(named) : (process.env.PROBE_BACKEND?.trim()
    ? urlSlug(process.env.PROBE_BACKEND.trim())
    : "cell-default");
  if (isRemote()) return `${base}${REMOTE_SUFFIX}`;
  return isPreview() ? `${base}${PREVIEW_SUFFIX}` : base;
};

/** Where one cell's captures belong: under the backend it was driven against,
 *  or under its own name when it runs its own agent (see `ownAgent`). */
export const captureKey = (frontend: Frontend): string =>
  frontend.adapter.ownAgent ? frontend.name : backendKey();

/** Whether a cell sits outside the backend grid, by name — what the gallery has
 *  to work with when it reads a manifest. */
export const outsideGrid = (name: string): boolean => ADAPTERS[name]?.ownAgent === true;

const stacks = (): string => readFileSync(join(ROOT, "scripts", "stacks.sh"), "utf8");

const entriesOf = (list: "FRONTENDS" | "BACKENDS"): Array<{ name: string; port: number }> => {
  const block = stacks().match(new RegExp(`${list}=\\(([\\s\\S]*?)\\)`));
  if (!block) throw new Error(`probes: no ${list}=(…) block in scripts/stacks.sh`);
  return [...block[1].matchAll(/"([\w-]+):(\d+)"/g)].map((m) => ({
    name: m[1],
    port: Number(m[2]),
  }));
};

/** The matrix in scripts/stacks.sh order — the gallery's columns and rows, so
 *  the layout doesn't depend on which run or worker finished first. */
export const matrixOrder = (): { cells: string[]; backends: string[] } => ({
  cells: entriesOf("FRONTENDS").map((e) => e.name),
  backends: entriesOf("BACKENDS").map((e) => e.name),
});

/** Read the matrix from scripts/stacks.sh so this file never has to be updated
 *  when a cell is added — only when a cell needs new selectors. */
export const frontends = (): { supported: Frontend[]; unsupported: Unsupported[] } => {
  const entries = entriesOf("FRONTENDS");
  // What counts as published depends on where the run is aimed. A remote run
  // carries the exact list — PROBE_BASES, filled by probe.sh from the same
  // topology publish.sh deployed against — so a cell missing from it is a cell
  // that was not deployed. That case used to fall through to `null`, and the
  // failure it produced is the worst kind: cellUrl() fell back to
  // http://localhost:<port>, so a --production run drove whatever happened to be
  // running on the machine and reported those passes as the deployment's. A
  // deployment that publishes four cells now reports the fifth as not-hosted
  // instead of green from a process the deployment has never met.
  const hosted = isRemote()
    ? new Set(Object.keys(bases()))
    : portOffset()
      ? hostedCells()
      : null;

  const supported: Frontend[] = [];
  const unsupported: Unsupported[] = [];
  for (const { name, port } of entries) {
    const adapter = ADAPTERS[name];
    if (!adapter) unsupported.push({ name, why: "no-adapter" });
    else if (hosted && !hosted.has(name)) unsupported.push({ name, why: "not-hosted" });
    else supported.push({ name, port, url: cellUrl(name, port), adapter });
  }
  return { supported, unsupported };
};

// One adapter per frontend: the only file that knows what any stack's DOM looks
// like. Everything else in probes/ is written against this interface, which is
// what lets one flow run against three unrelated UIs.
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

  // Server-rendered: every selector below is a Jinja template's handwriting,
  // written to this file's interface on purpose (frontends/jinja, plan §3.3).
  // The Stop button exists only while a run is in flight, which is the busy
  // tell; the tool name is visible text in the card header, so toolNamed's
  // default works. Nothing collapses. The thread lives in the process that
  // renders the page, so a reload re-renders it rather than starting over —
  // which is what `resumes` declares, and what the `resume` flow holds it to.
  jinja: {
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

/** `PROBE_BACKEND=http://localhost:8002` drives every cell against that backend
 *  instead of its default — the hub's `?backend=` carried through the open step.
 *  `PROBE_PORT_OFFSET=1000` drives the hosted preview (scripts/preview.sh),
 *  which serves each cell's static export at its port plus the offset. */
const cellUrl = (port: number): string => {
  const backend = process.env.PROBE_BACKEND;
  const at = port + portOffset();
  return backend
    ? `http://localhost:${at}/?backend=${encodeURIComponent(backend)}`
    : `http://localhost:${at}`;
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

/** Read the matrix from scripts/stacks.sh so this file never has to be updated
 *  when a cell is added — only when a cell needs new selectors. */
export const frontends = (): { supported: Frontend[]; unsupported: Unsupported[] } => {
  const stacks = readFileSync(join(ROOT, "scripts", "stacks.sh"), "utf8");
  const block = stacks.match(/FRONTENDS=\(([\s\S]*?)\)/);
  if (!block) throw new Error("probes: no FRONTENDS=(…) block in scripts/stacks.sh");

  const entries = [...block[1].matchAll(/"([\w-]+):(\d+)"/g)].map((m) => ({
    name: m[1],
    port: Number(m[2]),
  }));
  const hosted = portOffset() ? hostedCells() : null;

  const supported: Frontend[] = [];
  const unsupported: Unsupported[] = [];
  for (const { name, port } of entries) {
    const adapter = ADAPTERS[name];
    if (!adapter) unsupported.push({ name, why: "no-adapter" });
    else if (hosted && !hosted.has(name)) unsupported.push({ name, why: "not-hosted" });
    else supported.push({ name, port, url: cellUrl(port), adapter });
  }
  return { supported, unsupported };
};

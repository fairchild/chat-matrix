/**
 * The reference agent, on pi. Same three tools as every backend in the matrix,
 * built with pi's `defineTool` and served through `createAgentSession`.
 *
 * pi is a coding agent, so its own tools (read, bash, edit, …) are switched off
 * here: the contract says every backend does identical work, and identical work
 * means these three tools and nothing else.
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { catalogue as modelCatalogue, initial, spec, unavailable, type Entry } from "./models.ts";
import { py } from "./pyrepr.ts";
import { scriptedProvider, SCRIPTED } from "./scripted.ts";

export const BACKEND_NAME = "pi";

export const INSTRUCTIONS = `
You are the demo agent for a chat-UI comparison harness. Use the tools when they
fit the question, and keep answers short — the point is to show the frontend
rendering, not to write essays.
`.trim();

export type Weather = {
  city: string;
  conditions: string;
  temperature_c: number;
  humidity_pct: number;
};

export type Note = { title: string; body: string; tags: string[] };

export const NOTES: readonly Note[] = [
  {
    title: "Streaming protocols",
    body:
      "The Vercel AI data stream and AG-UI both ride SSE, but AG-UI carries " +
      "explicit state-delta events where the AI SDK stream carries UI message parts.",
    tags: ["protocol", "streaming"],
  },
  {
    title: "Tool-call rendering",
    body:
      "Frontends differ most in the gap between a tool being called and its " +
      "result arriving — some show args streaming in, some show only a spinner.",
    tags: ["ui", "tools"],
  },
  {
    title: "Thread persistence",
    body:
      "Client-authoritative history is the AI SDK default; the server keeps its " +
      "own copy so a reload can rehydrate.",
    tags: ["state", "persistence"],
  },
  {
    title: "Generative UI",
    body:
      "Backend-driven components are where protocols diverge: AG-UI models it " +
      "natively, the AI SDK route leans on typed tool results the client maps to components.",
    tags: ["ui", "protocol"],
  },
];

const CONDITIONS = ["clear", "overcast", "drizzle", "windy", "crisp and sunny"] as const;

/** Tools get pi's abort signal, so a client that goes away doesn't leave `analyze` sleeping. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

/** pi tools return text for the model and `details` for everything else; the
 *  structured value goes in both so the wire gets JSON and the UI gets a shape. */
const result = <T>(details: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(details) }],
  details,
});

export const getWeather = defineTool({
  name: "get_weather",
  label: "Weather",
  description: "Current conditions for a city. Fast, small, structured.",
  parameters: Type.Object({ city: Type.String({ description: "City name" }) }),
  execute: async (_id, { city }, signal) => {
    await sleep(200, signal);
    const seed = [...city].reduce((sum, ch) => sum + ch.codePointAt(0)!, 0);
    return result<Weather>({
      city,
      conditions: CONDITIONS[seed % CONDITIONS.length]!,
      temperature_c: 4 + (seed % 26),
      humidity_pct: 35 + (seed % 50),
    });
  },
});

export const searchNotes = defineTool({
  name: "search_notes",
  label: "Search notes",
  description: "Search the demo note corpus. Returns a list, so frontends can render cards.",
  parameters: Type.Object({ query: Type.String({ description: "Search terms" }) }),
  execute: async (_id, { query }, signal) => {
    await sleep(400, signal);
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
    const hits = NOTES.filter((note) =>
      terms.some(
        (term) => note.title.toLowerCase().includes(term) || note.body.toLowerCase().includes(term),
      ),
    );
    return result<Note[]>(hits.length ? hits : NOTES.slice(0, 2));
  },
});

export const analyze = defineTool({
  name: "analyze",
  label: "Analyze",
  description: "A deliberately slow analysis, for watching how a frontend handles latency.",
  parameters: Type.Object({ topic: Type.String({ description: "What to analyze" }) }),
  execute: async (_id, { topic }, signal) => {
    await sleep(3000, signal);
    return result<string>(
      `Analysis of ${py(topic)}: three factors dominate — how the protocol frames ` +
        `streaming, how much glue the frontend needs, and whether state survives a ` +
        `reload. This backend took ~3s on purpose.`,
    );
  },
});

export const TOOLS: readonly ToolDefinition[] = [getWeather, searchNotes, analyze];
export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

// The pi side: one ModelRuntime for the process, one AgentSession per request.

const modelRuntime = await ModelRuntime.create();
modelRuntime.registerNativeProvider(scriptedProvider());

export const MODEL_SPEC = initial(modelRuntime, process.env.DEMO_MODEL ?? SCRIPTED);
/** The boot default. The running model is `currentModel()` — the hub can change it. */

/** `scripted` is registered above; anything else is pi's `provider/model[:thinking]`. */
export function resolveModel(id: string): { model: Model<string>; thinkingLevel: ThinkingLevel } {
  if (id === SCRIPTED) return { model: modelRuntime.getModel(SCRIPTED, SCRIPTED)!, thinkingLevel: "off" };
  const resolved = resolveCliModel({ cliModel: spec(modelRuntime, id), modelRuntime });
  if (resolved.error || !resolved.model)
    throw new Error(
      `${id}: ${resolved.error ?? "not found"}\n` +
        "pi spells models provider/model[:thinking], e.g. anthropic/claude-opus-4-5; `pi --list-models` lists them.",
    );
  return { model: resolved.model, thinkingLevel: resolved.thinkingLevel ?? "off" };
}

let { model, thinkingLevel } = ((): { model: Model<string>; thinkingLevel: ThinkingLevel } => {
  try {
    const resolved = resolveModel(MODEL_SPEC);
    // `DEMO_MODEL` takes any pi model string, catalogue or not, so a boot-time
    // model can be one nothing has credentials for. Say so rather than fail —
    // the picker is there to choose another without a restart.
    if (MODEL_SPEC !== SCRIPTED && !modelRuntime.hasConfiguredAuth(resolved.model.provider))
      console.warn(
        `DEMO_MODEL=${MODEL_SPEC}: no credentials for ${resolved.model.provider} — \`pi\` can log in, or set the provider's env var.`,
      );
    return resolved;
  } catch (error) {
    console.error(`DEMO_MODEL=${MODEL_SPEC}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
})();

let current = MODEL_SPEC;

export const currentModel = (): string => current;

export const models = (): Entry[] => modelCatalogue(modelRuntime, current);

/**
 * Swap the running model. Sessions read it when they open, so the next turn
 * picks it up; a turn already streaming finishes on the model it started with.
 */
export function useModel(id: string): void {
  const reason = unavailable(modelRuntime, id);
  if (reason) throw new Error(reason);
  ({ model, thinkingLevel } = resolveModel(id));
  current = id;
}

const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });

/**
 * No extensions, skills, prompt templates or AGENTS.md discovery: the user's own
 * pi setup must not leak into a comparison harness.
 */
const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  settingsManager,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  systemPromptOverride: () => INSTRUCTIONS,
});
await resourceLoader.reload();

/** A pi session over the given session file: prior turns come from the file. */
export async function openSession(sessionManager: SessionManager): Promise<AgentSession> {
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    model,
    thinkingLevel,
    modelRuntime,
    tools: [...TOOL_NAMES],
    customTools: [...TOOLS],
    resourceLoader,
    settingsManager,
    sessionManager,
  });
  return session;
}

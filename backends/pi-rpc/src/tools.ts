/**
 * The reference agent's three tools — the same three every backend in the
 * matrix implements — as pi tools. This file runs inside the pi child process:
 * `extension.ts` registers these with `pi.registerTool`, and pi's own tool loop
 * calls `execute`. The server imports it only for the names.
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { py } from "./pyrepr.ts";

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

/** Tools get pi's abort signal, so an aborted turn doesn't leave `analyze` sleeping. */
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

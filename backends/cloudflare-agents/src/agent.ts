/**
 * The reference agent from `protocol/CONTRACT.md`, on the AI SDK.
 *
 * Three tools, one per thing worth comparing: `get_weather` returns a small
 * structured value, `search_notes` returns a list worth rendering as cards, and
 * `analyze` takes long enough that you can watch a frontend handle a slow call.
 * Behaviour mirrors the pydantic-ai backend so a frontend gets the same work.
 */

import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";

export const BACKEND_NAME = "cloudflare-agents";
export const SDK_VERSION = 7;

export const INSTRUCTIONS =
  "You are the demo agent for a chat-UI comparison harness. Use the tools when they " +
  "fit the question, and keep answers short — the point is to show the frontend " +
  "rendering, not to write essays.";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CONDITIONS = ["clear", "overcast", "drizzle", "windy", "crisp and sunny"] as const;

type Note = { title: string; body: string; tags: string[] };

const NOTES: readonly Note[] = [
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

export const tools = {
  get_weather: tool({
    description: "Current conditions for a city. Fast, small, structured.",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => {
      await sleep(200);
      const seed = [...city].reduce((sum, character) => sum + character.codePointAt(0)!, 0);
      return {
        city,
        conditions: CONDITIONS[seed % CONDITIONS.length],
        temperature_c: 4 + (seed % 26),
        humidity_pct: 35 + (seed % 50),
      };
    },
  }),

  search_notes: tool({
    description: "Search the demo note corpus. Returns a list, so frontends can render cards.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      await sleep(400);
      const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
      const hits = NOTES.filter((note) =>
        terms.some((term) => note.title.toLowerCase().includes(term) || note.body.toLowerCase().includes(term)),
      );
      return hits.length ? hits : NOTES.slice(0, 2);
    },
  }),

  analyze: tool({
    description: "A deliberately slow analysis, for watching how a frontend handles latency.",
    inputSchema: z.object({ topic: z.string() }),
    execute: async ({ topic }) => {
      await sleep(3000);
      return (
        `Analysis of '${topic}': three factors dominate — how the protocol frames ` +
        "streaming, how much glue the frontend needs, and whether state survives a " +
        "reload. This backend took ~3s on purpose."
      );
    },
  }),
};

export const TOOL_NAMES = Object.keys(tools);

export type OnFinish = (responseMessages: ModelMessage[]) => void;

export type Run = ReturnType<typeof runAgent>;

export function runAgent(model: LanguageModel, messages: ModelMessage[], onFinish: OnFinish) {
  return streamText({
    model,
    system: INSTRUCTIONS,
    messages,
    tools,
    stopWhen: stepCountIs(5),
    onFinish: ({ responseMessages }) => onFinish(responseMessages),
  });
}

/**
 * A deterministic model, so the frontend is the only thing under comparison.
 *
 * The same script as the pydantic-ai backend's `scripted.py`, expressed as a
 * pi-ai `Provider`: pick tools by keyword, stream a canned answer at a visible
 * pace. It plugs into pi's `ModelRuntime` like any other provider, so the agent
 * loop, tool execution and session persistence are all real — only the model's
 * choices are scripted.
 */

import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  type Provider,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";

import type { Note, Weather } from "./agent.ts";
import { py, pyJson, pyTuple } from "./pyrepr.ts";

export const SCRIPTED = "scripted";

const TOKEN_DELAY_MS = 35;
/** Slow enough to see tokens arrive, fast enough not to be annoying. */

type Plan = {
  tool: string;
  keywords: readonly string[];
  buildArgs: (text: string) => Record<string, string>;
};

const city = (text: string): string =>
  /\bin ([A-Z][\p{L}\p{N}_'-]*(?: [A-Z][\p{L}\p{N}_'-]*)*)/u.exec(text)?.[1] ?? "San Francisco";

const trimPunct = (text: string) => text.replace(/^[ ?.!]+|[ ?.!]+$/g, "");

const topic = (text: string): string => {
  const stripped = text.replace(/^\s*(please\s+)?(analyze|analyse|research|compare|dig into)\s+/i, "");
  return trimPunct(stripped) || trimPunct(text);
};

const PLANS: readonly Plan[] = [
  {
    tool: "get_weather",
    keywords: ["weather", "forecast", "temperature", "rain", "sunny", "cold"],
    buildArgs: (text) => ({ city: city(text) }),
  },
  {
    tool: "search_notes",
    keywords: ["note", "notes", "search", "find", "look up", "remember"],
    buildArgs: (text) => ({ query: topic(text) }),
  },
  {
    tool: "analyze",
    keywords: ["analyze", "analyse", "research", "compare", "deep dive", "investigate"],
    buildArgs: (text) => ({ topic: topic(text) }),
  },
];

const INTRO =
  "I'm the scripted demo model, so I answer from a fixed script rather than a " +
  "provider. Try asking about **the weather in Tokyo**, telling me to " +
  "**search notes for streaming**, or asking me to **analyze assistant-ui** — " +
  "each one exercises a different tool so you can see how this frontend renders it.";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How each tool's result prints in the summary — the shapes pydantic-ai's
 * scripted model prints (`f"{part.content}"` on a dataclass), so the same
 * prompt yields the same bytes from either backend.
 */
const RENDER: Record<string, (details: unknown) => string> = {
  get_weather: (d) => {
    const w = d as Weather;
    return `Weather(city=${py(w.city)}, conditions=${py(w.conditions)}, temperature_c=${w.temperature_c}, humidity_pct=${w.humidity_pct})`;
  },
  search_notes: (d) =>
    `[${(d as Note[])
      .map((n) => `Note(title=${py(n.title)}, body=${py(n.body)}, tags=${pyTuple(n.tags)})`)
      .join(", ")}]`,
  analyze: (d) => String(d),
};

function latestUserText(messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    // Attachments make content a list; the text parts are still the prompt.
    return typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part): part is TextContent => part.type === "text")
          .map((part) => part.text)
          .join(" ");
  }
  return "";
}

/** The trailing run of tool results — what pydantic-ai hands back as one ModelRequest. */
function pendingToolResults(messages: readonly Message[]): ToolResultMessage[] {
  const returns: ToolResultMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "toolResult") break;
    returns.unshift(message);
  }
  return returns;
}

const matchingPlans = (text: string): Plan[] => {
  const lowered = text.toLowerCase();
  return PLANS.filter((plan) => plan.keywords.some((word) => lowered.includes(word)));
};

function summary(returns: readonly ToolResultMessage[]): string {
  const named = [...new Set(returns.map((part) => part.toolName))].sort().join(", ");
  const lines = [`Here's what I found (via ${named}).`, ""];
  for (const part of returns) {
    const render = RENDER[part.toolName] ?? ((details: unknown) => JSON.stringify(details));
    lines.push(`- **${part.toolName}** returned: ${render(part.details)}`);
  }
  lines.push("", "Ask a follow-up and I'll keep going.");
  return lines.join("\n");
}

const emptyMessage = (model: Model<string>): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "pending",
  timestamp: Date.now(),
});

function stream(
  model: Model<string>,
  context: Context,
  options?: { signal?: AbortSignal },
): AssistantMessageEventStream {
  const events = createAssistantMessageEventStream();
  const output = emptyMessage(model);
  const signal = options?.signal;

  const emitText = async (text: string) => {
    const block: TextContent = { type: "text", text: "" };
    const contentIndex = output.content.push(block) - 1;
    events.push({ type: "text_start", contentIndex, partial: output });
    for (const token of text.match(/\S+\s*/g) ?? []) {
      await sleep(TOKEN_DELAY_MS);
      signal?.throwIfAborted();
      block.text += token;
      events.push({ type: "text_delta", contentIndex, delta: token, partial: output });
    }
    events.push({ type: "text_end", contentIndex, content: block.text, partial: output });
    output.stopReason = "stop";
  };

  const emitToolCalls = async (plans: readonly Plan[], userText: string) => {
    for (const [index, plan] of plans.entries()) {
      const args = plan.buildArgs(userText);
      const call: ToolCall = {
        type: "toolCall",
        id: `call_${plan.tool}_${index}`,
        name: plan.tool,
        arguments: {},
      };
      const contentIndex = output.content.push(call) - 1;
      events.push({ type: "toolcall_start", contentIndex, partial: output });
      // Split the arguments so the UI has a chance to show them streaming in.
      const json = pyJson(args);
      const midpoint = Math.floor(json.length / 2);
      for (const delta of [json.slice(0, midpoint), json.slice(midpoint)]) {
        await sleep(TOKEN_DELAY_MS);
        signal?.throwIfAborted();
        events.push({ type: "toolcall_delta", contentIndex, delta, partial: output });
      }
      call.arguments = args;
      events.push({ type: "toolcall_end", contentIndex, toolCall: call, partial: output });
    }
    output.stopReason = "toolUse";
  };

  (async () => {
    try {
      events.push({ type: "start", partial: output });

      const returns = pendingToolResults(context.messages);
      if (returns.length) {
        await emitText(summary(returns));
      } else {
        const userText = latestUserText(context.messages);
        const available = new Set((context.tools ?? []).map((tool) => tool.name));
        const plans = matchingPlans(userText).filter((plan) => available.has(plan.tool));
        if (plans.length) await emitToolCalls(plans, userText);
        else await emitText(INTRO);
      }

      events.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
      events.end(output);
    } catch (error) {
      output.stopReason = signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      events.push({ type: "error", reason: output.stopReason, error: output });
      events.end(output);
    }
  })();

  return events;
}

export function scriptedProvider(): Provider {
  const model: Model<string> = {
    id: SCRIPTED,
    name: "scripted",
    api: SCRIPTED,
    provider: SCRIPTED,
    baseUrl: "http://localhost:0",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
  return createProvider({
    id: SCRIPTED,
    name: "scripted",
    // Keyless: `resolve` reporting an auth object is what marks it configured.
    auth: { apiKey: { name: "none", resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: { stream, streamSimple: stream },
  });
}

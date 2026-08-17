/**
 * A deterministic model, so the frontend is the only thing under comparison.
 *
 * The same script as the pydantic-ai backend's `scripted.py`: tools picked by
 * keyword, arguments streamed in two halves, a canned reply paced at a visible
 * rate. The tools still execute for real — only the model's choices are scripted,
 * so two backends given the same prompt hand a frontend the same work to render.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";

/** Slow enough to see tokens arrive, fast enough not to be annoying. */
export const TOKEN_DELAY_MS = 35;

type Plan = {
  tool: string;
  keywords: readonly string[];
  buildArgs: (text: string) => Record<string, string>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const cityIn = (text: string): string =>
  /\bin ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*)/.exec(text)?.[1] ?? "San Francisco";

const trimPunctuation = (text: string): string => text.replace(/^[ ?.!]+|[ ?.!]+$/g, "");

const topicOf = (text: string): string =>
  trimPunctuation(
    text.replace(/^\s*(please\s+)?(analyze|analyse|research|compare|dig into)\s+/i, ""),
  ) || trimPunctuation(text);

const PLANS: readonly Plan[] = [
  {
    tool: "get_weather",
    keywords: ["weather", "forecast", "temperature", "rain", "sunny", "cold"],
    buildArgs: (text) => ({ city: cityIn(text) }),
  },
  {
    tool: "search_notes",
    keywords: ["note", "notes", "search", "find", "look up", "remember"],
    buildArgs: (text) => ({ query: topicOf(text) }),
  },
  {
    tool: "analyze",
    keywords: ["analyze", "analyse", "research", "compare", "deep dive", "investigate"],
    buildArgs: (text) => ({ topic: topicOf(text) }),
  },
];

const FALLBACK =
  "I'm the scripted demo model, so I answer from a fixed script rather than a " +
  "provider. Try asking about **the weather in Tokyo**, telling me to " +
  "**search notes for streaming**, or asking me to **analyze assistant-ui** — " +
  "each one exercises a different tool so you can see how this frontend renders it.";

const NO_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

const finish = (unified: LanguageModelV4FinishReason["unified"]): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified, raw: undefined },
  usage: NO_USAGE,
});

/** Python's `json.dumps` spacing, so the streamed argument halves match the reference backend byte for byte. */
const dumps = (args: Record<string, string>): string =>
  `{${Object.entries(args)
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(", ")}}`;

function latestUserText(prompt: LanguageModelV4Prompt): string {
  for (let index = prompt.length - 1; index >= 0; index--) {
    const message = prompt[index];
    if (message.role !== "user") continue;
    return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  }
  return "";
}

function pendingToolReturns(prompt: LanguageModelV4Prompt): LanguageModelV4ToolResultPart[] {
  const last = prompt.at(-1);
  if (last?.role !== "tool") return [];
  return last.content.filter((part): part is LanguageModelV4ToolResultPart => part.type === "tool-result");
}

const render = (output: LanguageModelV4ToolResultOutput): string =>
  output.type === "text" || output.type === "error-text"
    ? output.value
    : JSON.stringify("value" in output ? output.value : output);

function summary(returns: LanguageModelV4ToolResultPart[]): string {
  const named = [...new Set(returns.map((part) => part.toolName))].sort().join(", ");
  return [
    `Here's what I found (via ${named}).`,
    "",
    ...returns.map((part) => `- **${part.toolName}** returned: ${render(part.output)}`),
    "",
    "Ask a follow-up and I'll keep going.",
  ].join("\n");
}

async function* script(options: LanguageModelV4CallOptions): AsyncGenerator<LanguageModelV4StreamPart> {
  yield { type: "stream-start", warnings: [] };

  const returns = pendingToolReturns(options.prompt);
  const userText = latestUserText(options.prompt);
  const available = new Set(
    (options.tools ?? []).flatMap((tool) => (tool.type === "function" ? [tool.name] : [])),
  );
  const lowered = userText.toLowerCase();
  const plans = returns.length
    ? []
    : PLANS.filter((plan) => plan.keywords.some((word) => lowered.includes(word)) && available.has(plan.tool));

  if (plans.length) {
    for (const [index, plan] of plans.entries()) {
      const id = `call_${plan.tool}_${index}`;
      const args = dumps(plan.buildArgs(userText));
      yield { type: "tool-input-start", id, toolName: plan.tool };
      // Split the arguments so the UI has a chance to show them streaming in.
      const midpoint = Math.floor(args.length / 2);
      for (const chunk of [args.slice(0, midpoint), args.slice(midpoint)]) {
        await sleep(TOKEN_DELAY_MS);
        yield { type: "tool-input-delta", id, delta: chunk };
      }
      yield { type: "tool-input-end", id };
      yield { type: "tool-call", toolCallId: id, toolName: plan.tool, input: args };
    }
    yield finish("tool-calls");
    return;
  }

  const id = crypto.randomUUID();
  yield { type: "text-start", id };
  for (const token of (returns.length ? summary(returns) : FALLBACK).match(/\S+\s*/g) ?? []) {
    await sleep(TOKEN_DELAY_MS);
    yield { type: "text-delta", id, delta: token };
  }
  yield { type: "text-end", id };
  yield finish("stop");
}

function toStream<T>(generator: AsyncGenerator<T>): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      const { value, done } = await generator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() {
      void generator.return(undefined);
    },
  });
}

export function scriptedModel(): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "scripted",
    modelId: "scripted",
    supportedUrls: {},

    async doStream(options) {
      return { stream: toStream(script(options)) };
    },

    async doGenerate(options) {
      const content: LanguageModelV4Content[] = [];
      let finishReason: LanguageModelV4FinishReason = { unified: "stop", raw: undefined };
      let text = "";
      for await (const part of script(options)) {
        if (part.type === "text-delta") text += part.delta;
        else if (part.type === "tool-call") content.push(part);
        else if (part.type === "finish") finishReason = part.finishReason;
      }
      if (text) content.unshift({ type: "text", text });
      return { content, finishReason, usage: NO_USAGE, warnings: [] };
    },
  };
}

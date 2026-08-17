// The step grammar: one regex per sentence the flows are allowed to say.
//
// Keeping it this small is the point. A flow that needs a word the grammar
// doesn't have is a flow that has started describing one frontend rather than
// the axis being compared — add the word here only when every cell can honour it.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type Step =
  | { kind: "open" }
  | { kind: "ask"; text: string }
  | { kind: "suggestion"; text: string }
  | { kind: "waitForToolCall" }
  | { kind: "waitForReply" }
  | { kind: "expandToolCall" }
  | { kind: "expectToolFor"; tool: string }
  | { kind: "expectToolCount"; count: number }
  | { kind: "expectMention"; text: string }
  | { kind: "expectMessages"; count: number; role: "user" | "assistant" }
  | { kind: "expectBusy"; busy: boolean }
  | { kind: "reload" }
  | { kind: "capture"; label: string };

type Rule = { pattern: RegExp; build: (m: RegExpMatchArray) => Step };

const RULES: Rule[] = [
  { pattern: /^open the chat$/, build: () => ({ kind: "open" }) },
  { pattern: /^ask "(.+)"$/, build: (m) => ({ kind: "ask", text: m[1] }) },
  {
    pattern: /^click the "(.+)" suggestion$/,
    build: (m) => ({ kind: "suggestion", text: m[1] }),
  },
  { pattern: /^wait for the tool call$/, build: () => ({ kind: "waitForToolCall" }) },
  { pattern: /^wait for the reply$/, build: () => ({ kind: "waitForReply" }) },
  { pattern: /^expand the tool call$/, build: () => ({ kind: "expandToolCall" }) },
  {
    pattern: /^expect a tool call for (\w+)$/,
    build: (m) => ({ kind: "expectToolFor", tool: m[1] }),
  },
  {
    pattern: /^expect (\d+) tool calls?$/,
    build: (m) => ({ kind: "expectToolCount", count: Number(m[1]) }),
  },
  {
    pattern: /^expect the reply to mention "(.+)"$/,
    build: (m) => ({ kind: "expectMention", text: m[1] }),
  },
  {
    pattern: /^expect (\d+) (user|assistant) messages?$/,
    build: (m) => ({
      kind: "expectMessages",
      count: Number(m[1]),
      role: m[2] as "user" | "assistant",
    }),
  },
  {
    pattern: /^expect the chat to be (busy|idle)$/,
    build: (m) => ({ kind: "expectBusy", busy: m[1] === "busy" }),
  },
  { pattern: /^reload the page$/, build: () => ({ kind: "reload" }) },
  {
    pattern: /^capture ([\w-]+)$/,
    build: (m) => ({ kind: "capture", label: m[1] }),
  },
];

export type Flow = {
  flow: string;
  axis: string;
  about: string;
  steps: Step[];
  source: string[];
};

export const parseStep = (line: string): Step => {
  const text = line.trim();
  for (const { pattern, build } of RULES) {
    const match = text.match(pattern);
    if (match) return build(match);
  }
  throw new Error(
    `probes: don't know how to "${text}".\nThe grammar is:\n  ${RULES.map((r) => r.pattern.source).join("\n  ")}`,
  );
};

export const loadFlows = (path: string): Flow[] => {
  const raw = parse(readFileSync(path, "utf8")) as Array<{
    flow: string;
    axis: string;
    about: string;
    steps: string[];
  }>;

  return raw.map((entry) => ({
    flow: entry.flow,
    axis: entry.axis,
    about: (entry.about ?? "").trim(),
    source: entry.steps,
    steps: entry.steps.map(parseStep),
  }));
};

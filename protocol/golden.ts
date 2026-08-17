/**
 * The golden check: every backend must give a frontend the reference's work.
 *
 * It captures each backend's `/chat` and `/ag-ui` streams for five fixed prompts, reduces them to a
 * canonical form that erases ids and timestamps and nothing else, and diffs that against fixtures
 * captured from `backends/pydantic-ai`. It replaces the hand diffs — one person normalising ids in
 * a scratch buffer, which is how cloudflare-agents' drift was found and then only written down.
 * The `follow-up` fixture is turn two of a thread, and the history it sends is rebuilt from turn
 * one's own stream: an approximation of what `useChat` and CopilotKit put on the wire, not a
 * capture of either client.
 *
 *   bun protocol/golden.ts                    check :8001
 *   bun protocol/golden.ts URL [URL…]         check each backend
 *   bun protocol/golden.ts --update [URL]     recapture the fixtures from URL
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Protocol = "chat" | "ag-ui";
export type Flow = { name: string; prompt: string; then?: string };
export type Exception = { protocol: Protocol; event: string; field: string; why: string };
type Message = Record<string, unknown>;
type Frame = Record<string, any>;

export const FLOWS: Flow[] = [
  { name: "weather", prompt: "What's the weather in Tokyo?" },
  { name: "notes", prompt: "Search notes for streaming protocols." },
  { name: "analyze", prompt: "Analyze assistant-ui as a chat frontend." },
  { name: "follow-up", prompt: "What's the weather in Tokyo?", then: "Search notes for streaming protocols." },
  { name: "multi-tool", prompt: "What's the weather in Tokyo, and search notes for streaming?" },
];
export const PROTOCOLS: Protocol[] = ["chat", "ag-ui"];

const GOLDEN = join(import.meta.dir, "golden");
const ID_KEYS = new Set(["id", "toolCallId", "messageId", "parentMessageId", "threadId", "runId"]);
const entries = (value: unknown) => Object.entries(value as Frame);

/** Keys sorted at every depth; at a frame's top level only, `timestamp` erased and ids renamed by
 * first appearance — an `id` inside a tool's output is that tool's content, and stays. */
const erase = (value: unknown, ids: Map<string, string>, top = true): unknown => {
  if (Array.isArray(value)) return value.map((item) => erase(item, ids, false));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => {
    if (top && key === "timestamp") return [key, "~"];
    if (!top || !ID_KEYS.has(key) || typeof item !== "string") return [key, erase(item, ids, false)];
    if (!ids.has(item)) ids.set(item, `#${ids.size + 1}`);
    return [key, ids.get(item)];
  }));
};

/** pydantic-ai stamps its own timestamp in a `message-metadata` chunk; that exact chunk is
 * dropped. Any other metadata is content and is compared. */
const STAMP = '{"messageMetadata":{"pydantic_ai":{"timestamp":"~"}},"type":"message-metadata"}';
const isStamp = (frame: Frame): boolean =>
  JSON.stringify(erase(frame, new Map())).replace(/"timestamp":"[^"]*"/, '"timestamp":"~"') === STAMP;

const dataLines = (frame: string): string[] =>
  frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());

export const linesOf = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);
export const textOf = (lines: string[]): string => (lines.length > 0 ? `${lines.join("\n")}\n` : "");

/** A body as one line per SSE data frame; the reference's timestamp stamp is dropped, an unparsable frame is kept. */
export function canonical(body: string): string {
  const ids = new Map<string, string>();
  const lines: string[] = [];
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = dataLines(frame);
    if (data.length === 0) continue;
    const raw = data.join("\n");
    if (raw === "[DONE]") { lines.push("[DONE]"); continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { lines.push(`!unparsed ${raw}`); continue; }
    if (isStamp(parsed as Frame)) continue;
    lines.push(JSON.stringify(erase(parsed, ids)));
  }
  return textOf(lines);
}

/** Delete each exception's field from the frames it names; `applied` collects the `event.field` that fired. */
export function applyExceptions(
  lines: string[], exceptions: Exception[], protocol: Protocol, applied: string[] = [],
): string[] {
  const mine = exceptions.filter((exception) => exception.protocol === protocol);
  if (mine.length === 0) return lines;
  return lines.map((line) => {
    if (!line.startsWith("{")) return line;
    const frame = JSON.parse(line) as Frame;
    let touched = false;
    for (const { event, field } of mine) {
      if (frame.type !== event || !(field in frame)) continue;
      delete frame[field];
      touched = true;
      if (!applied.includes(`${event}.${field}`)) applied.push(`${event}.${field}`);
    }
    return touched ? JSON.stringify(frame) : line;
  });
}

const parseFrames = (body: string): Frame[] =>
  body.split(/\r?\n\r?\n/).flatMap(dataLines).flatMap((raw) => {
    try { return raw && raw !== "[DONE]" ? [JSON.parse(raw) as Frame] : []; } catch { return []; }
  });

const userMessage = (protocol: Protocol, id: string, text: string): Message =>
  protocol === "chat" ? { id, role: "user", parts: [{ type: "text", text }] } : { id, role: "user", content: text };

/** Turn two's request: turn one's stream rebuilt into the history a client would send back. */
export function followUp(protocol: Protocol, turnOne: string, first: string, second: string): Message[] {
  const frames = parseFrames(turnOne);
  const user = (id: string, text: string) => userMessage(protocol, id, text);
  let text = "";
  if (protocol === "chat") {
    const calls = new Map<string, { name: string; input: unknown; output?: unknown }>();
    for (const frame of frames) {
      if (frame.type === "tool-input-available") calls.set(frame.toolCallId, { name: frame.toolName, input: frame.input });
      if (frame.type === "tool-output-available" && calls.has(frame.toolCallId)) calls.get(frame.toolCallId)!.output = frame.output;
      if (frame.type === "text-delta") text += frame.delta ?? "";
    }
    const parts: Message[] = [...calls].map(([toolCallId, call]) => ({
      type: `tool-${call.name}`, toolCallId, state: "output-available", input: call.input, output: call.output,
    }));
    const assistant = { id: "a1", role: "assistant", parts: [...parts, { type: "text", text, state: "done" }] };
    return [user("m1", first), assistant, user("m2", second)];
  }
  const names = new Map<string, string>();
  const args = new Map<string, string>();
  const results: Message[] = [];
  for (const frame of frames) {
    if (frame.type === "TOOL_CALL_START") names.set(frame.toolCallId, frame.toolCallName);
    if (frame.type === "TOOL_CALL_ARGS") args.set(frame.toolCallId, (args.get(frame.toolCallId) ?? "") + (frame.delta ?? ""));
    if (frame.type === "TOOL_CALL_RESULT")
      results.push({ id: `t${results.length + 1}`, role: "tool", content: frame.content, toolCallId: frame.toolCallId });
    if (frame.type === "TEXT_MESSAGE_CONTENT") text += frame.delta ?? "";
  }
  const toolCalls = [...names].map(([id, name]) => ({ id, type: "function", function: { name, arguments: args.get(id) ?? "" } }));
  return [
    user("m1", first),
    ...(toolCalls.length > 0 ? [{ id: "a1", role: "assistant", toolCalls }] : []),
    ...results,
    { id: "a2", role: "assistant", content: text },
    user("m2", second),
  ];
}

async function post(url: string, protocol: Protocol, thread: string, messages: Message[]): Promise<string> {
  const path = protocol === "chat" ? "/chat" : "/ag-ui";
  const body = protocol === "chat"
    ? { id: thread, trigger: "submit-message", messages }
    : { threadId: thread, runId: "run-1", state: {}, messages, tools: [], context: [], forwardedProps: {} };
  const response = await fetch(url + path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`POST ${path} → ${response.status}`);
  return await response.text();
}

async function capture(url: string, flow: Flow, protocol: Protocol, thread: string): Promise<string> {
  const first = [userMessage(protocol, "m1", flow.prompt)];
  if (!flow.then) return await post(url, protocol, thread, first);
  const turnOne = await post(url, protocol, thread, first);
  return await post(url, protocol, thread, followUp(protocol, turnOne, flow.prompt, flow.then));
}

const fixtureName = (flow: Flow, protocol: Protocol) => `${flow.name}.${protocol}.ndjson`;
const threadId = (flow: Flow, protocol: Protocol) =>
  `golden-${process.pid}-${flow.name}${protocol === "chat" ? "" : "-agui"}`;

const paint = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
const [green, red, yellow, bold] = [paint(32), paint(31), paint(33), paint(1)];
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function backendHealth(url: string): Promise<{ name: string; model: string }> {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GET /health → ${response.status}`);
  const health = (await response.json()) as { backend?: string; model?: string };
  return { name: health.backend ?? url, model: health.model ?? "unknown" };
}

/** Every fixture at once, consumed in the fixtures' order. A failed capture is a difference like
 * any other, so it travels as text rather than as a rejection. */
const captureAll = (url: string) =>
  FLOWS.flatMap((flow) => PROTOCOLS.map((protocol) => ({
    flow, protocol,
    body: capture(url, flow, protocol, threadId(flow, protocol)).catch((error) => `!capture ${error}`),
  })));

const cleanup = (url: string) =>
  Promise.all(FLOWS.flatMap((flow) => PROTOCOLS.map((protocol) =>
    fetch(`${url}/threads/${threadId(flow, protocol)}`, { method: "DELETE" }).catch(() => {}))));

/** Unified diff of the two texts, headed by where each side came from, indented under its ✗. */
async function unified(golden: string, actual: string, file: string, backend: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "golden-"));
  const [want, got] = [join(dir, "golden"), join(dir, "actual")];
  writeFileSync(want, golden);
  writeFileSync(got, actual);
  const proc = Bun.spawn(["diff", "-u", want, got], { stderr: "ignore" });
  const body = (await new Response(proc.stdout).text()).split("\n").slice(2).join("\n");
  rmSync(dir, { recursive: true, force: true });
  return [`--- golden/${file}`, `+++ ${backend}`, ...body.trimEnd().split("\n")]
    .filter((line) => line.length > 0).map((line) => `    ${line}`).join("\n");
}

/** One pass over the fixtures; `--update` writes what a check would have compared. */
async function run(url: string, exceptions: Record<string, Exception[]>, updating: boolean): Promise<boolean> {
  let name: string;
  let model: string;
  try { ({ name, model } = await backendHealth(url)); } catch (error) {
    console.log(`  ${red("✗")} ${url} unreachable — is the backend running? (${error})`);
    return false;
  }
  // The model is switchable at runtime now, so it has to be checked here rather
  // than assumed from how the backend was started. Golden compares bytes, and a
  // real provider makes different bytes every run — there'd be nothing to learn
  // from the diff, so refuse instead of printing one.
  if (model !== "scripted") {
    console.log(
      bold(`\ngolden: ${name} · ${url}`) +
        `\n  ${red("✗")} running on ${model}, not scripted — golden compares bytes, which only means` +
        `\n    something on a deterministic model. Switch it back at the hub, or:` +
        `\n    curl -X POST ${url}/model -H 'content-type: application/json' -d '{"id":"scripted"}'`,
    );
    return false;
  }
  const out = [bold(`\ngolden${updating ? " --update" : ""}: ${name} · ${url}`)];
  if (updating && name !== "pydantic-ai") out.push(`  ${yellow("⚠")} not the reference (pydantic-ai) — capturing anyway`);
  let same = 0;
  let excepted = 0;
  try {
    for (const job of captureAll(url)) {
      const { flow, protocol } = job;
      const body = await job.body;
      const file = fixtureName(flow, protocol);
      const applied: string[] = [];
      const mine = updating ? [] : (exceptions[name] ?? []);
      const actual = textOf(applyExceptions(linesOf(canonical(body)), mine, protocol, applied));
      const label = `${flow.name.padEnd(11)}${`/${protocol}`.padEnd(8)}`;
      const line = `${label}${applied.map((one) => yellow(`⚠ ${one} excepted`)).join(" ")}`.trimEnd();
      excepted += applied.length;
      if (body.startsWith("!capture")) { out.push(`  ${red("✗")} ${line} ${body}`); continue; }
      if (updating) {
        writeFileSync(join(GOLDEN, file), actual);
        out.push(`  ${green("✓")} ${line} → golden/${file} (${count(linesOf(actual).length, "frame")})`);
        same += 1;
        continue;
      }
      const fixture = Bun.file(join(GOLDEN, file));
      const golden = (await fixture.exists()) ? await fixture.text() : "";
      if (golden === actual) { out.push(`  ${green("✓")} ${line}`); same += 1; continue; }
      out.push(`  ${red("✗")} ${line}`, await unified(golden, actual, file, name));
    }
  } finally { await cleanup(url); }
  const total = FLOWS.length * PROTOCOLS.length;
  out.push(`  ${bold(updating ? `${same} captured, ${total - same} failed`
    : `${same} identical, ${total - same} differ, ${count(excepted, "exception")} applied`)}`);
  console.log(out.join("\n"));
  return same === total;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const updating = args[0] === "--update";
  const urls = args.filter((arg) => !arg.startsWith("--"));
  if (urls.length === 0) urls.push("http://localhost:8001");
  if (updating && urls.length > 1) throw new Error("--update takes one URL");
  const exceptions = JSON.parse(readFileSync(join(GOLDEN, "exceptions.json"), "utf8"));
  const results = await Promise.all(urls.map((url) => run(url, exceptions, updating)));
  process.exit(results.every(Boolean) ? 0 : 1);
}

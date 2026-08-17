/**
 * The normaliser's adversary: mutations the canonical form must catch and ones it must ignore —
 * each one editing a live capture from the reference (`:8001`, or `GOLDEN_URL`) so the raw SSE path
 * is what gets mutated, and asserting the bytes really changed so nothing passes as a no-op.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyExceptions, canonical, linesOf, textOf, type Exception } from "./golden";
const [URL, GOLDEN, TAG, WEATHER] = [process.env.GOLDEN_URL ?? "http://localhost:8001", join(import.meta.dir, "golden"), `golden-test-${process.pid}`, "What's the weather in Tokyo?"];
const fixture = (file: string) => readFileSync(join(GOLDEN, file), "utf8");
const post = (path: string, body: unknown): Promise<string> => fetch(URL + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) })
  .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`POST ${URL}${path} → ${response.status} — is the reference up?`))));
const chat = (thread: string, text: string) => post("/chat", { id: thread, trigger: "submit-message", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }] });
const frames = (body: string): string[] => body.split(/\r?\n\r?\n/).flatMap((frame) => frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())).filter(Boolean);
const sse = (payloads: string[]) => payloads.map((payload) => `data: ${payload}\n\n`).join("");
const { model } = (await (await fetch(`${URL}/health`)).json()) as { model?: string };
if (model !== "scripted") throw new Error(`${URL} is on ${model}, not scripted — every case here reads the scripted model's own bytes`);
const [w, m, a] = (await Promise.all([chat(`${TAG}-w`, WEATHER), chat(`${TAG}-m`, "What's the weather in Tokyo, and search notes for streaming?"),
  post("/ag-ui", { threadId: `${TAG}-a`, runId: "run-1", state: {}, tools: [], context: [], forwardedProps: {}, messages: [{ id: "m1", role: "user", content: WEATHER }] })])).map(frames);
await Promise.all(["w", "m", "a"].map((one) => fetch(`${URL}/threads/${TAG}-${one}`, { method: "DELETE" }).catch(() => {})));
const edit = (ps: string[], i: number, change: (frame: any) => void) => { const f = JSON.parse(ps[i]); change(f); return ps.with(i, JSON.stringify(f)); };
const find = (ps: string[], type: string) => ps.flatMap((p, i) => (p.startsWith("{") && JSON.parse(p).type === type ? [i] : []));
const call = (ps: string[], i: number) => JSON.parse(ps[i]).toolCallId as string;
const split = (o: any) => [{ ...o, delta: o.delta.slice(0, 2) }, { ...o, delta: o.delta.slice(2) }].map((f) => JSON.stringify(f));
const rename = (ps: string[]) => { const seen = new Map<string, string>(); return ps.map((p) => p.replace(/"(id|toolCallId|messageId|parentMessageId|threadId|runId)":"([^"]*)"/g,
  (_, key: string, value: string) => `"${key}":"${seen.get(value) ?? (seen.set(value, `renamed-${seen.size}`), seen.get(value)!)}"`)); };
const reorder = (p: string) => (p.startsWith("{") ? JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(p)).reverse())) : p);
const [summary, delta, outs, starts] = [w.findIndex((p) => p.includes("Weather(city=")), find(w, "text-delta")[0], find(m, "tool-output-available"), find(m, "tool-input-start")];
const [d0, d1, cafe] = [JSON.parse(w[delta]), JSON.parse(w[delta + 1]), edit(w, delta, (f) => (f.delta = "café "))];
const under = (key: string, value: string) => edit(w, find(w, "tool-output-available")[0], (f) => (f.output = { ...f.output, [key]: value }));
const inContent = (value: string) => edit(a, find(a, "TOOL_CALL_RESULT")[0], (f) => (f.content = JSON.stringify({ ...JSON.parse(f.content), id: value })));
const mutate = (before: string[], after: string[]) => { expect(sse(after)).not.toBe(sse(before)); return canonical(sse(after)); };

test.each([
  ["a tool output re-paired to the other call", m, edit(edit(m, outs[0], (f) => (f.toolCallId = call(m, outs[1]))), outs[1], (f) => (f.toolCallId = call(m, outs[0])))],
  ["a dropped text-delta", w, w.filter((_, i) => i !== delta)],
  ["one changed byte inside a summary delta", w, edit(w, summary, (f) => (f.delta = f.delta.replace("W", "w")))],
  ["two adjacent events swapped", w, w.with(delta, w[delta + 1]).with(delta + 1, w[delta])],
  ["finish gaining a field", w, edit(w, find(w, "finish")[0], (f) => (f.finishReason = "stop"))],
  ["one delta split into two", w, w.toSpliced(delta, 1, ...split(d0))],
  ["two adjacent deltas merged into one", w, w.toSpliced(delta, 2, JSON.stringify({ ...d0, delta: d0.delta + d1.delta }))],
  ["the two tool outputs reordered, ids left alone", m, m.with(outs[0], m[outs[1]]).with(outs[1], m[outs[0]])],
  ["a second call reusing the first call's id", m, m.map((p) => p.split(call(m, starts[1])).join(call(m, starts[0])))],
  ["unicode swapped into a delta", w, edit(w, delta, (f) => (f.delta = "Héré's "))],
  ["a frame replaced by one that is not JSON", w, w.with(delta, w[delta].slice(0, -1))],
  ["a stream missing [DONE]", w, w.filter((p) => p !== "[DONE]")],
  ["a message-metadata chunk carrying anything but the stamp", w, w.toSpliced(1, 0, '{"type":"message-metadata","messageMetadata":{"not":"a timestamp"}}')],
  ["an id nested inside a /chat tool output changed", under("id", "note-7"), under("id", "note-9")],
  ["a timestamp nested inside a /chat tool output changed", under("timestamp", "2020-01-01"), under("timestamp", "2999-12-31")],
])("catches %s", (_name, before, after) => expect(mutate(before, after)).not.toBe(canonical(sse(before))));

test.each([
  ["ids replaced by other unique values, pairing kept (/chat)", w, rename(w)],
  ["ids replaced by other unique values, pairing kept (/ag-ui)", a, rename(a)],
  ["different timestamps", a, a.map((p) => p.replace(/"timestamp":\d+/, '"timestamp":1'))],
  ["different key order inside every frame", w, w.map(reorder)],
  ["the reference's message-metadata timestamp stamp removed", w, w.filter((p) => !p.includes("message-metadata"))],
  ["the stamp inserted again with another timestamp", w, w.toSpliced(1, 0, '{"type":"message-metadata","messageMetadata":{"pydantic_ai":{"timestamp":"1999-01-01T00:00:00Z"}}}')],
  ["a non-ASCII byte written as a \\u escape", cafe, cafe.map((p) => p.replace("café", "caf\\u00e9"))],
])("ignores %s", (_name, before, after) => expect(mutate(before, after)).toBe(canonical(sse(before))));
test("ignores the SSE framing itself: CRLF, no space after data:, an event: name line", () =>
  [(t: string) => t.replaceAll("\n", "\r\n"), (t: string) => t.replaceAll("data: ", "data:"), (t: string) => t.replaceAll("data: ", "event: message\ndata: ")]
    .forEach((reframe) => expect(canonical(reframe(sse(w)))).toBe(canonical(sse(w)))));
test.each(readdirSync(GOLDEN).filter((name) => name.endsWith(".ndjson")))("%s round-trips", (file) =>
  expect(canonical(sse(linesOf(fixture(file))))).toBe(fixture(file)));
test("an id inside /ag-ui's TOOL_CALL_RESULT.content (a JSON string) is content too", () =>
  expect(canonical(sse(inContent("note-7")))).not.toBe(canonical(sse(inContent("note-9")))));
const EXCEPTIONS: Exception[] = JSON.parse(fixture("exceptions.json"))["cloudflare-agents"];
const apply = (ps: string[], protocol: "chat" | "ag-ui", applied: string[] = []) => [textOf(applyExceptions(linesOf(canonical(sse(ps))), EXCEPTIONS, protocol, applied)), applied] as const;
test("the cloudflare exception drops finishReason from finish, from nothing else, and not on ag-ui", () => {
  const mutated = edit(edit(w, find(w, "finish")[0], (f) => { f.finishReason = "stop"; f.usage = { in: 1 }; }), find(w, "finish-step")[0], (f) => (f.finishReason = "stop"));
  const [out, applied] = apply(mutated, "chat");
  expect(applied).toEqual(["finish.finishReason"]);
  expect(linesOf(out)).toEqual(expect.arrayContaining(['{"type":"finish","usage":{"in":1}}', '{"finishReason":"stop","type":"finish-step"}']));
  expect(apply(w, "chat")).toEqual([canonical(sse(w)), []]);
  const agui = edit(a, find(a, "RUN_FINISHED")[0], (f) => { f.type = "finish"; f.finishReason = "stop"; });
  expect(apply(agui, "ag-ui")).toEqual([canonical(sse(agui)), []]);
});

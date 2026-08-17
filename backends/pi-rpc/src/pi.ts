/**
 * pi as a subprocess. Each thread gets its own `pi --mode rpc` child, spoken to
 * over stdin/stdout JSONL — commands in, `response` lines and session events
 * out — and kept warm between turns until it has been idle for a while.
 *
 * One child per thread is pi's shape, not a choice: an RPC process holds one
 * session at a time, `switch_session` wants an existing file, and `new_session`
 * picks its own id, so the only way to open a session *by thread id* is on the
 * command line at spawn. The pool below just keeps those spawns from repeating
 * on every turn.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { JsonAgentSessionEvent, RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

export type PiEvent = JsonAgentSessionEvent;

export const INSTRUCTIONS = `
You are the demo agent for a chat-UI comparison harness. Use the tools when they
fit the question, and keep answers short — the point is to show the frontend
rendering, not to write essays.
`.trim();

/** pi's own RPC entry point (`dist/rpc-entry.js`), run under the same bun as this server. */
const RPC_ENTRY = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
const EXTENSION = fileURLToPath(import.meta.resolve("./extension.ts"));

export type ChildOptions = { model: string; sessionDir: string; sessionId: string };

/**
 * The child's argv. No built-in tools, no discovery of the developer's own
 * extensions, skills, prompt templates or AGENTS.md — the extension is the whole
 * agent — and the session opened by id, so the file is the thread.
 */
export const childArgs = ({ model, sessionDir, sessionId }: ChildOptions): string[] => [
  "--extension", EXTENSION,
  "--model", model,
  "--no-builtin-tools",
  "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
  "--system-prompt", INSTRUCTIONS,
  "--session-dir", sessionDir,
  "--session-id", sessionId,
];

type Pending = { resolve: (response: RpcResponse) => void; reject: (error: Error) => void };

export class PiChild {
  private readonly proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: PiEvent) => void>();
  private stderr = "";
  private nextId = 0;
  private exitError?: Error;
  /** Settles when the process is gone, with the reason — never rejects. */
  readonly exited: Promise<Error>;
  busy = false;
  lastUsed = Date.now();

  constructor(readonly threadId: string, args: string[]) {
    this.proc = Bun.spawn([process.execPath, RPC_ENTRY, ...args], {
      cwd: process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.readLines(this.proc.stdout, (line) => this.handleLine(line));
    void this.readLines(this.proc.stderr, (line) => (this.stderr += `${line}\n`));
    this.exited = this.proc.exited.then((code) => {
      const detail = this.stderr.trim().split("\n").filter(Boolean).at(-1);
      this.exitError = new Error(`pi exited (${code})${detail ? `: ${detail}` : ""}`);
      for (const { reject } of this.pending.values()) reject(this.exitError);
      this.pending.clear();
      return this.exitError;
    });
  }

  /** Strict JSONL: split on `\n` only (a JSON string may hold U+2028), tolerate `\r\n`. */
  private async readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    }
    if (buffer) onLine(buffer);
  }

  private handleLine(line: string) {
    let parsed: RpcResponse | PiEvent;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.type === "response") {
      const pending = parsed.id !== undefined ? this.pending.get(parsed.id) : undefined;
      if (!pending) return;
      this.pending.delete(parsed.id!);
      pending.resolve(parsed);
      return;
    }
    for (const listener of this.listeners) listener(parsed);
  }

  /** Send a command; resolves with its `response` line, rejects if pi says `success: false` or dies first. */
  async request(command: RpcCommand): Promise<RpcResponse> {
    if (this.exitError) throw this.exitError;
    const id = String(++this.nextId);
    const response = new Promise<RpcResponse>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    try {
      this.proc.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      await this.proc.stdin.flush();
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    const result = await response;
    if (!result.success) throw new Error(`pi ${command.type}: ${result.error}`);
    return result;
  }

  prompt(message: string, images: ImageContent[]) {
    return this.request({ type: "prompt", message, images: images.length ? images : undefined });
  }

  abort() {
    return this.request({ type: "abort" }).catch(() => undefined);
  }

  subscribe(listener: (event: PiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Closing stdin is pi's shutdown signal; SIGTERM is the fallback if it lingers. */
  kill() {
    if (this.exitError) return;
    try {
      this.proc.stdin.end();
    } catch {}
    setTimeout(() => this.proc.kill(), 1000).unref?.();
  }
}

export type PoolOptions = { model: string; sessionDir: string; idleMs: number; max: number };

/**
 * The warm children, one per thread. A child that has been idle for `idleMs`
 * is shut down; past `max` resident children the oldest idle one goes first,
 * because each idles at ~200 MB. Busy children are never evicted, so the cap is
 * on memory, not on concurrency.
 */
export class Pool {
  private readonly children = new Map<string, PiChild>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: PoolOptions) {}

  get size() {
    return this.children.size;
  }

  /** The thread's child, warm or freshly spawned and ready — i.e. it has answered its first command. */
  async acquire(threadId: string, sessionId: string): Promise<PiChild> {
    const warm = this.children.get(threadId);
    if (warm) {
      clearTimeout(this.timers.get(threadId));
      warm.lastUsed = Date.now();
      return warm;
    }
    this.makeRoom();
    const child = new PiChild(threadId, childArgs({ ...this.options, sessionId }));
    this.children.set(threadId, child);
    void child.exited.then(() => this.forget(threadId, child));
    // Readiness doubles as configuration: pi reads the developer's settings, and
    // the reference agent doesn't compact.
    try {
      await child.request({ type: "set_auto_compaction", enabled: false });
    } catch (error) {
      this.forget(threadId, child);
      child.kill();
      throw error;
    }
    return child;
  }

  /** Back to the pool; the idle clock starts now. */
  release(child: PiChild) {
    child.busy = false;
    child.lastUsed = Date.now();
    clearTimeout(this.timers.get(child.threadId));
    this.timers.set(
      child.threadId,
      setTimeout(() => this.evict(child.threadId), this.options.idleMs),
    );
  }

  evict(threadId: string) {
    clearTimeout(this.timers.get(threadId));
    this.timers.delete(threadId);
    const child = this.children.get(threadId);
    if (!child) return;
    this.children.delete(threadId);
    child.kill();
  }

  /** The child is gone (exited or evicted); drop it unless the thread has already been given a new one. */
  private forget(threadId: string, child: PiChild) {
    if (this.children.get(threadId) === child) this.evict(threadId);
  }

  private makeRoom() {
    if (this.children.size < this.options.max) return;
    const idle = [...this.children.values()].filter((child) => !child.busy).sort((a, b) => a.lastUsed - b.lastUsed);
    if (idle[0]) this.evict(idle[0].threadId);
  }

  killAll() {
    for (const threadId of [...this.children.keys()]) this.evict(threadId);
  }
}

/**
 * Threads are pi sessions. One `.jsonl` per thread under `data/sessions/`,
 * written by pi's own `SessionManager` as the run proceeds — there is no
 * second store and no "save on completion" step, because pi already owns a
 * durable, append-only record of every turn.
 *
 * That makes this backend session-authoritative: prior turns come from the file,
 * not from whatever history the client sent along. See CONTRACT.md's State
 * section for why that is a real divergence rather than a detail.
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type ThreadSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

/** pi session ids allow `[A-Za-z0-9._-]` with alphanumeric ends; thread ids are close enough to coerce. */
export function sessionIdFor(threadId: string): string {
  const cleaned = threadId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  return cleaned || "thread";
}

const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "+00:00");

const title = (text: string) => {
  const collapsed = text.split(/\s+/).join(" ").trim();
  return collapsed ? collapsed.slice(0, 60) + (collapsed.length > 60 ? "…" : "") : "New thread";
};

export class ThreadStore {
  private readonly dir: string;
  private readonly cwd = process.cwd();

  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  /** pi names files `<timestamp>_<id>.jsonl`, so the id is recoverable from the name. */
  private pathFor(threadId: string): string | undefined {
    const suffix = `_${sessionIdFor(threadId)}.jsonl`;
    const name = readdirSync(this.dir).find((file) => file.endsWith(suffix));
    return name && join(this.dir, name);
  }

  exists(threadId: string): boolean {
    return this.pathFor(threadId) !== undefined;
  }

  /** The SessionManager to run a turn against: the existing file, or a fresh session with the thread's id. */
  open(threadId: string): SessionManager {
    const path = this.pathFor(threadId);
    return path
      ? SessionManager.open(path, this.dir, this.cwd)
      : SessionManager.create(this.cwd, this.dir, { id: sessionIdFor(threadId) });
  }

  history(threadId: string): AgentMessage[] {
    const path = this.pathFor(threadId);
    if (!path) return [];
    return SessionManager.open(path, this.dir, this.cwd).buildSessionContext().messages;
  }

  async list(): Promise<ThreadSummary[]> {
    const sessions: SessionInfo[] = await SessionManager.listAll(this.dir);
    return sessions
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .map((session) => ({
        id: session.id,
        title: title(session.firstMessage),
        created_at: isoSeconds(session.created),
        updated_at: isoSeconds(session.modified),
        message_count: session.messageCount,
      }));
  }

  delete(threadId: string): boolean {
    const path = this.pathFor(threadId);
    if (!path || !existsSync(path)) return false;
    rmSync(path);
    return true;
  }
}

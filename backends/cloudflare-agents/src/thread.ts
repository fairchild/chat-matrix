import { RunAgentInputSchema } from "@ag-ui/core";
import { Agent, getAgentByName, type AgentContext } from "agents";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { modelFor, runAgent } from "./agent";
import { agUiResponse } from "./agui";
import { fromAgUiMessages } from "./messages";
import { registryStub } from "./registry";

type Row = { title: string; created_at: string; updated_at: string; messages: string };

/** Second-precision UTC with an explicit offset, the shape the pydantic-ai backend writes. */
const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

export function deriveTitle(messages: ModelMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const raw =
      typeof message.content === "string"
        ? message.content
        : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    const text = raw.split(/\s+/).filter(Boolean).join(" ");
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }
  return "New thread";
}

/**
 * One Agent per conversation. Its name is the thread id, its SQLite holds the
 * thread's messages, and runs stream from inside it — the Durable Object that
 * owns the history is the one doing the work, which is the Agents SDK's model.
 */
export class Thread extends Agent<Env> {
  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.sql`create table if not exists thread (
      id         integer primary key check (id = 1),
      title      text not null,
      created_at text not null,
      updated_at text not null,
      messages   text not null
    )`;
  }

  async onRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (pathname === "/chat") return this.chat(await request.json());
    if (pathname === "/ag-ui") return this.agUi(await request.json());
    return new Response("not found", { status: 404 });
  }

  /** Vercel AI data stream protocol — what assistant-ui's useChat speaks. */
  private async chat(body: { messages: UIMessage[] }): Promise<Response> {
    const history = await convertToModelMessages(body.messages, { ignoreIncompleteToolCalls: true });
    return this.run(history).toUIMessageStreamResponse();
  }

  /** AG-UI protocol — the same agent, a different wire format. */
  private agUi(body: unknown): Response {
    const input = RunAgentInputSchema.parse(body);
    return agUiResponse(input, this.run(fromAgUiMessages(input.messages)));
  }

  private run(history: ModelMessage[]) {
    return runAgent(modelFor(this.env.DEMO_MODEL ?? "scripted"), history, (responseMessages) =>
      this.ctx.waitUntil(this.persist([...history, ...responseMessages])),
    );
  }

  /** History is client-authoritative during a turn and server-persisted after it: record the result. */
  private async persist(messages: ModelMessage[]): Promise<void> {
    const stamp = now();
    this.sql`insert into thread (id, title, created_at, updated_at, messages)
      values (1, ${deriveTitle(messages)}, ${stamp}, ${stamp}, ${JSON.stringify(messages)})
      on conflict(id) do update set
        title = excluded.title,
        updated_at = excluded.updated_at,
        messages = excluded.messages`;
    const [row] = this.sql<Omit<Row, "messages">>`select title, created_at, updated_at from thread where id = 1`;
    await (await registryStub(this.env)).upsert({ id: this.name, ...row, message_count: messages.length });
  }

  /** Stored history, or null if this thread has never completed a run. */
  history(): ModelMessage[] | null {
    const [row] = this.sql<Pick<Row, "messages">>`select messages from thread where id = 1`;
    return row ? (JSON.parse(row.messages) as ModelMessage[]) : null;
  }

  /** Forget the thread. Returns whether there was one. */
  remove(): boolean {
    const had = this.history() !== null;
    this.sql`delete from thread`;
    return had;
  }
}

/** RPC view of one thread, plus the fetch that reaches `onRequest`. */
export type ThreadStub = {
  fetch(request: Request): Promise<Response>;
  history(): Promise<ModelMessage[] | null>;
  remove(): Promise<boolean>;
};

export const threadStub = async (env: Env, id: string): Promise<ThreadStub> =>
  (await getAgentByName(env.Thread, id)) as unknown as ThreadStub;

import { Agent, getAgentByName, type AgentContext } from "agents";

export type ThreadSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

/**
 * The one place that knows every thread. Durable Objects don't enumerate
 * themselves, so a singleton (`getAgentByName(env.Registry, "index")`) keeps
 * the summaries that `/threads` and `/health` read.
 */
export class Registry extends Agent<Env> {
  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    this.sql`create table if not exists threads (
      id            text primary key,
      title         text not null,
      created_at    text not null,
      updated_at    text not null,
      message_count integer not null
    )`;
  }

  upsert(summary: ThreadSummary): void {
    this.sql`insert into threads (id, title, created_at, updated_at, message_count)
      values (${summary.id}, ${summary.title}, ${summary.created_at}, ${summary.updated_at}, ${summary.message_count})
      on conflict(id) do update set
        title = excluded.title,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count`;
  }

  remove(id: string): boolean {
    const had = this.sql`select 1 from threads where id = ${id}`.length > 0;
    this.sql`delete from threads where id = ${id}`;
    return had;
  }

  list(): ThreadSummary[] {
    return this.sql<ThreadSummary>`select id, title, created_at, updated_at, message_count
      from threads order by updated_at desc`;
  }

  count(): number {
    return this.sql<{ n: number }>`select count(*) as n from threads`[0]?.n ?? 0;
  }
}

/** RPC view of the singleton. Typed by hand: the stub type over the whole Agent class is too deep for tsc. */
export type RegistryStub = {
  upsert(summary: ThreadSummary): Promise<void>;
  remove(id: string): Promise<boolean>;
  list(): Promise<ThreadSummary[]>;
  count(): Promise<number>;
};

export const registryStub = async (env: Env): Promise<RegistryStub> =>
  (await getAgentByName(env.Registry, "index")) as unknown as RegistryStub;

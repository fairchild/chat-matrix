import {
  getToolName,
  isToolUIPart,
  type ChatStatus,
  type DynamicToolUIPart,
} from "ai";
import type {
  ActiveTurnData,
  FolioMessage,
  SessionViewData,
} from "@fairchild/folio";

import type { Health } from "./backend";
import type { ChatMessagePart, ChatUIMessage } from "./messages";

/**
 * The host's side of Folio's boundary.
 *
 * Folio renders a projection the host writes from its own events — it never
 * discovers state — so everything the surface shows has to be assembled here
 * from the two things this cell has: `useChat`'s message list, and `/health`.
 * That is the whole cost of putting Folio in front of a stream it was not
 * designed around, and it is meant to be read as a number of lines.
 */
export interface Projection {
  messages: ChatUIMessage[];
  health: Health | null;
  status: ChatStatus;
  /** send → finish, per assistant message id. Nothing else here can time a turn. */
  turnMs: Record<string, number>;
  /** The three probe prompts, shown as text — Folio has no suggestions slot. */
  emptyHint: string;
  error?: Error;
}

type ChatToolPart = Extract<ChatMessagePart, { toolCallId: string }>;

/**
 * Folio's ledger reads `dynamic-tool` parts and nothing else, while `useChat`
 * against this repo's backends produces typed `tool-<name>` parts. The two
 * carry the same fields, so the rename is the projection — apart from the
 * output rule below, which is the part that isn't.
 */
function asDynamicTool(part: ChatToolPart): DynamicToolUIPart {
  const renamed = { ...part, type: "dynamic-tool", toolName: getToolName(part) };
  return (
    renamed.state === "output-available"
      ? { ...renamed, output: asLedgerBody(renamed.output) }
      : renamed
  ) as DynamicToolUIPart;
}

/**
 * A string output is the row's body; an object needs a string `content`, and
 * anything else renders no body at all. Two of the three reference tools return
 * a struct and a list, so without this their rows would be a verb and nothing.
 *
 * Stringifying is the deliberate floor. Writing a sentence per tool is the
 * shadcn route — a hand-written component for work the cell already knows the
 * shape of — and a cell that did that would be measuring its author rather than
 * the surface's defaults.
 */
function asLedgerBody(output: unknown): unknown {
  return typeof output === "string"
    ? output
    : { content: JSON.stringify(output, null, 2) };
}

/** Text, reasoning and tool calls are what the transcript renders; the rest of
 *  the AI SDK's part vocabulary has nowhere to land and is dropped. */
function asFolioParts(parts: ChatMessagePart[]): FolioMessage["parts"] {
  return parts.flatMap((part): FolioMessage["parts"] => {
    if (part.type === "text" || part.type === "reasoning") return [part];
    return isToolUIPart(part) ? [asDynamicTool(part as ChatToolPart)] : [];
  });
}

/**
 * The receipt, and the rule that keeps it short: the tool count is on the wire
 * and the client can time its own turn, so those two are real. Nothing in this
 * stream prices a token — pydantic-ai's `/chat` sends no usage — so `tokenCount`
 * stays absent rather than arriving as a confident zero.
 */
function toFolioMessages(
  messages: ChatUIMessage[],
  agentName: string,
  turnMs: Record<string, number>
): FolioMessage[] {
  return messages.map((message) => {
    const durationMs = turnMs[message.id];
    return {
      id: message.id,
      role: message.role,
      parts: asFolioParts(message.parts),
      metadata: {
        author: message.role === "user" ? "you" : agentName,
        ...(message.role === "assistant" && durationMs !== undefined
          ? {
              turnStats: {
                toolCount: message.parts.filter(isToolUIPart).length,
                durationMs,
              },
            }
          : {}),
      },
    } satisfies FolioMessage;
  });
}

/**
 * A failed turn, as the turn it failed on. Folio hangs Retry off
 * `metadata.error`, so a cell that wired the action but never set the field
 * would be offering a control nothing can reach; when the request dies before
 * any assistant message exists, the turn still needs somewhere to be recorded.
 */
function withFailure(
  messages: FolioMessage[],
  agentName: string,
  error: Error
): FolioMessage[] {
  const last = messages.at(-1);
  const failed = { author: agentName, error: error.message };
  if (last?.role === "assistant")
    return [...messages.slice(0, -1), { ...last, metadata: failed }];
  return [...messages, { id: "failed-turn", role: "assistant", parts: [], metadata: failed }];
}

/**
 * What the activity line says while a turn runs, read off the newest part.
 * Folio shows no arguments and no badge, so this line and a bodiless ledger row
 * are the whole of what three seconds of `analyze` looks like.
 */
function activeTurn(
  messages: ChatUIMessage[],
  agentName: string
): ActiveTurnData {
  const last = messages.at(-1);
  const part = last?.role === "assistant" ? last.parts.at(-1) : undefined;
  if (part === undefined) return { agentName, action: "Thinking" };
  if (part.type === "text") return { agentName, action: "Writing" };
  if (isToolUIPart(part) && part.state.startsWith("input"))
    return { agentName, action: `Calling \`${getToolName(part)}\`` };
  return { agentName, action: "Working" };
}

export function toSessionView({
  messages,
  health,
  status,
  turnMs,
  emptyHint,
  error,
}: Projection): SessionViewData {
  const busy = status === "submitted" || status === "streaming";
  // Before /health answers there is no backend name to attribute a message to,
  // and "agent" is the honest placeholder rather than a guess at which one.
  const agentName = health?.backend ?? "agent";
  const turns = toFolioMessages(messages, agentName, turnMs);

  return {
    masthead: {
      repo: agentName,
      // The model is what actually varies across a column of this matrix, which
      // is as close to a branch as this cell has.
      branch: health?.model ?? null,
      title: "",
      agentName,
      // Which side owns the thread, straight from the contract's own field.
      stateLabel: health ? `history · ${health.history}` : "",
      live: busy,
    },
    messages: error ? withFailure(turns, agentName, error) : turns,
    ...(busy ? { activeTurn: activeTurn(messages, agentName) } : {}),
    statusLine: { model: health?.model ?? "" },
    empty: { title: `folio × ${agentName}`, hint: emptyHint },
  };
}

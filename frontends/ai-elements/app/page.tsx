"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type DynamicToolUIPart,
  isToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { CopyIcon, MessagesSquareIcon, RefreshCcwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8001";

type Health = {
  backend: string;
  model: string;
  tools: string[];
  threads: number;
};

/** Same badge as the other two cells, so the three are directly comparable. */
function BackendBadge() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/health`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
      <span className="font-medium">AI Elements</span>
      <span className="text-muted-foreground">→</span>
      {health ? (
        <>
          <span className="font-medium">{health.backend}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {health.model}
          </span>
          <span className="text-muted-foreground">
            {health.tools.join(" · ")}
          </span>
          <span className="ml-auto text-muted-foreground">
            {health.threads} stored {health.threads === 1 ? "thread" : "threads"}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">
          {error ? `backend unreachable at ${BACKEND} (${error})` : "connecting…"}
        </span>
      )}
    </header>
  );
}

// One suggestion per comparison axis, so each probe is one click away.
const SUGGESTIONS = [
  "What's the weather in Tokyo?",
  "Search notes for streaming protocols.",
  "Analyze assistant-ui as a chat frontend.",
];

/**
 * `defaultOpen` is the whole difference between "a tool ran" and "here is what it
 * ran with and what came back". The registry's own examples leave it closed.
 *
 * The input guard is load-bearing: between `tool-input-start` and the first
 * `tool-input-delta` the part has no `input`, and `ToolInput` hands
 * `JSON.stringify(undefined)` — not a string — straight to `CodeBlock.split`.
 */
function ToolCall({ part }: { part: ToolUIPart | DynamicToolUIPart }) {
  return (
    <Tool defaultOpen>
      {part.type === "dynamic-tool" ? (
        <ToolHeader
          state={part.state}
          toolName={part.toolName}
          type="dynamic-tool"
        />
      ) : (
        <ToolHeader state={part.state} type={part.type} />
      )}
      <ToolContent>
        {part.input === undefined ? (
          <Shimmer className="text-xs">Streaming arguments…</Shimmer>
        ) : (
          <ToolInput input={part.input} />
        )}
        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

const sourceParts = (message: UIMessage) =>
  message.parts.filter(
    (part) => part.type === "source-url" || part.type === "source-document",
  );

const hasVisibleText = (message: UIMessage) =>
  message.parts.some((part) => part.type === "text" && part.text.length > 0);

export default function Home() {
  // Swapping backends is this one URL. No proxy route, no server-side glue.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${BACKEND}/chat` }),
    [],
  );
  const { messages, sendMessage, status, stop, regenerate } = useChat({
    transport,
  });

  const last = messages.at(-1);
  // The scripted `analyze` tool sleeps ~3s: the latency axis is what fills that gap.
  const awaitingText =
    status === "submitted" ||
    (status === "streaming" &&
      (last?.role !== "assistant" || !hasVisibleText(last)));

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text.trim()) {
      return;
    }
    sendMessage({ text: message.text });
  };

  return (
    <div className="flex h-full flex-col">
      <BackendBadge />
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col divide-y">
        <Conversation>
          <ConversationContent>
            {messages.length === 0 && (
              <ConversationEmptyState
                description="One prompt per axis below — fast tool, list result, slow call."
                icon={<MessagesSquareIcon className="size-8" />}
                title="AI Elements × pydantic-ai"
              />
            )}
            {messages.map((message) => {
              const sources = sourceParts(message);
              const isLast = message.id === last?.id;

              return (
                <Message from={message.role} key={message.id}>
                  {sources.length > 0 && (
                    <Sources>
                      <SourcesTrigger count={sources.length} />
                      <SourcesContent>
                        {sources.map((source, index) => (
                          <Source
                            href={
                              source.type === "source-url"
                                ? source.url
                                : undefined
                            }
                            key={`${message.id}-source-${index}`}
                            title={source.title}
                          />
                        ))}
                      </SourcesContent>
                    </Sources>
                  )}

                  {message.parts.map((part, index) => {
                    const key = `${message.id}-${index}`;

                    if (part.type === "text") {
                      return (
                        <MessageContent key={key}>
                          <MessageResponse
                            caret="block"
                            isAnimating={part.state === "streaming"}
                          >
                            {part.text}
                          </MessageResponse>
                        </MessageContent>
                      );
                    }

                    if (part.type === "reasoning") {
                      return (
                        <Reasoning
                          isStreaming={part.state === "streaming"}
                          key={key}
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }

                    if (isToolUIPart(part)) {
                      return <ToolCall key={key} part={part} />;
                    }

                    return null;
                  })}

                  {message.role === "assistant" && hasVisibleText(message) && (
                    <MessageToolbar>
                      <MessageActions>
                        <MessageAction
                          label="Copy"
                          onClick={() =>
                            navigator.clipboard.writeText(
                              message.parts
                                .filter((part) => part.type === "text")
                                .map((part) => part.text)
                                .join("\n"),
                            )
                          }
                          tooltip="Copy"
                        >
                          <CopyIcon className="size-4" />
                        </MessageAction>
                        {isLast && (
                          <MessageAction
                            disabled={status !== "ready"}
                            label="Regenerate"
                            onClick={() => regenerate()}
                            tooltip="Regenerate"
                          >
                            <RefreshCcwIcon className="size-4" />
                          </MessageAction>
                        )}
                      </MessageActions>
                    </MessageToolbar>
                  )}
                </Message>
              );
            })}

            {awaitingText && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer>Working…</Shimmer>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="grid shrink-0 gap-3 p-4">
          <Suggestions>
            {SUGGESTIONS.map((suggestion) => (
              <Suggestion
                key={suggestion}
                onClick={(text) => sendMessage({ text })}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea placeholder="Send a message…" />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

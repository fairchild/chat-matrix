import { type UIDataTypes, type UIMessage } from "ai"

/**
 * The template infers this from its own `tools/` definitions with
 * `InferUITools`. Here the tools live in the backend, so the frontend declares
 * the wire shape it expects instead — the same `tool-<name>` part types, minus
 * any ability to execute them. `protocol/CONTRACT.md` is the source of truth.
 */
export interface Weather {
  city: string
  conditions: string
  temperature_c: number
  humidity_pct: number
}

export interface Note {
  title: string
  body: string
  tags: string[]
}

export type ChatTools = {
  get_weather: { input: { city: string }; output: Weather }
  search_notes: { input: { query: string }; output: Note[] }
  analyze: { input: { topic: string }; output: string }
}

export type ChatUIMessage = UIMessage<unknown, UIDataTypes, ChatTools>

export type ChatMessagePart = ChatUIMessage["parts"][number]

export type TextMessagePart = Extract<ChatMessagePart, { type: "text" }>

export type SourceUrlPart = Extract<ChatMessagePart, { type: "source-url" }>

export type WeatherToolPart = Extract<
  ChatMessagePart,
  { type: "tool-get_weather" }
>

export type SearchNotesToolPart = Extract<
  ChatMessagePart,
  { type: "tool-search_notes" }
>

export type AnalyzeToolPart = Extract<ChatMessagePart, { type: "tool-analyze" }>

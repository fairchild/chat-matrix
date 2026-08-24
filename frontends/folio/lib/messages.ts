import { type UIDataTypes, type UIMessage } from "ai";

/**
 * The wire shape this cell expects, declared rather than inferred: the tools
 * live in the backend, so there are no `tools/` definitions here to run
 * `InferUITools` over. `protocol/CONTRACT.md` is the source of truth.
 */
export interface Weather {
  city: string;
  conditions: string;
  temperature_c: number;
  humidity_pct: number;
}

export interface Note {
  title: string;
  body: string;
  tags: string[];
}

export type ChatTools = {
  get_weather: { input: { city: string }; output: Weather };
  search_notes: { input: { query: string }; output: Note[] };
  analyze: { input: { topic: string }; output: string };
};

export type ChatUIMessage = UIMessage<unknown, UIDataTypes, ChatTools>;

export type ChatMessagePart = ChatUIMessage["parts"][number];

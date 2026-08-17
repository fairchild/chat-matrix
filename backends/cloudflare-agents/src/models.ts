/**
 * What this backend can reach, and why — the data behind the hub's model picker.
 *
 * Availability is a claim about credentials, so every candidate is listed either
 * way and carries its reason. That matters most here, because this backend has
 * two different kinds of "no": OpenAI is wired and waiting for a key, while
 * Anthropic and Google aren't wired at all. From the outside those look
 * identical unless the list says which is which.
 *
 * A Worker has no ambient credentials — no environment to read, no login on
 * disk — so `via` is always a binding. Locally that binding comes from
 * `.dev.vars`; on a deployed Worker, from `wrangler secret put`.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { scriptedModel } from "./scripted";

export const SCRIPTED = "scripted";
export const AUTO = "auto";
/** `DEMO_MODEL=auto` takes the first candidate whose binding is set. */

/**
 * The Worker's bindings, plus the provider keys that may not be declared yet.
 * `wrangler types` only learns a secret's name once `.dev.vars` exists, and a
 * fresh clone typechecks before it does — so the names live here rather than
 * being read off generated output that comes and goes.
 */
type ProviderBinding = "OPENAI_API_KEY";
type Bindings = Env & Partial<Record<ProviderBinding, string>>;

export type Candidate = {
  id: string;
  label: string;
  /** The binding carrying this provider's key. Absent means the provider isn't wired here. */
  binding?: ProviderBinding;
  build?: (apiKey: string) => LanguageModel;
};

/** Ordered, and the order is what `auto` walks: OpenAI, then Anthropic, then Google. */
export const CANDIDATES: readonly Candidate[] = [
  {
    id: "openai/gpt-5.6-luna",
    label: "OpenAI · gpt-5.6-luna",
    binding: "OPENAI_API_KEY",
    build: (apiKey) => createOpenAI({ apiKey })("gpt-5.6-luna"),
  },
  { id: "anthropic/claude-opus-5", label: "Anthropic · claude-opus-5" },
  { id: "google/gemini-3.1-pro-preview", label: "Google · gemini-3.1-pro-preview" },
];

const BY_ID = new Map(CANDIDATES.map((candidate) => [candidate.id, candidate]));

export type Entry = {
  id: string;
  label: string;
  available: boolean;
  via: string | null;
  why: string | null;
};

const NOT_WIRED = "not wired for this backend — it carries the OpenAI provider only";

/** An empty binding counts as absent: `.dev.vars.example` ships the name with no value. */
const keyFor = (env: Env, candidate: Candidate): string | undefined =>
  candidate.binding ? (env as Bindings)[candidate.binding] || undefined : undefined;

export function catalogue(env: Env, current: string): Entry[] {
  const entries: Entry[] = [
    { id: SCRIPTED, label: "scripted", available: true, via: "built in", why: null },
  ];
  for (const candidate of CANDIDATES) {
    const available = keyFor(env, candidate) !== undefined;
    entries.push({
      id: candidate.id,
      label: candidate.label,
      available,
      via: available ? `${candidate.binding} binding` : null,
      why: available ? null : candidate.binding ? `no ${candidate.binding} binding` : NOT_WIRED,
    });
  }
  if (current !== SCRIPTED && !BY_ID.has(current))
    entries.push({ id: current, label: `${current} · from DEMO_MODEL`, available: false, via: null, why: NOT_WIRED });
  return entries;
}

/** Why this id can't be selected, or undefined if it can. */
export function unavailable(env: Env, id: string): string | undefined {
  if (id === SCRIPTED) return undefined;
  const candidate = BY_ID.get(id);
  if (!candidate) return `unknown model ${JSON.stringify(id)} — GET /models lists what this backend offers`;
  if (!candidate.binding) return `${id} is ${NOT_WIRED}`;
  if (!keyFor(env, candidate)) return `no credentials for ${id} — set the ${candidate.binding} binding`;
  return undefined;
}

/** The model behind an id. Throws for anything this backend can't serve — the picker checks first. */
export function modelFor(env: Env, id: string): LanguageModel {
  if (id === SCRIPTED) return scriptedModel();
  const candidate = BY_ID.get(id);
  const apiKey = candidate && keyFor(env, candidate);
  if (!candidate?.build || !apiKey) throw new Error(unavailable(env, id) ?? `cannot serve ${id}`);
  return candidate.build(apiKey);
}

/** `DEMO_MODEL` as given, except `auto`, which resolves against the bindings that are set. */
export function initial(env: Env): string {
  // Widened on purpose: `wrangler types` narrows a declared var to its literal
  // value, so `env.DEMO_MODEL` types as `"scripted"` however it's overridden.
  const demoModel: string = env.DEMO_MODEL ?? SCRIPTED;
  if (demoModel !== AUTO) return demoModel;
  return CANDIDATES.find((candidate) => keyFor(env, candidate))?.id ?? SCRIPTED;
}

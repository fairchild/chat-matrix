/**
 * What this backend can reach, and why — the data behind the hub's model picker.
 *
 * Availability is a claim about credentials, so every candidate is listed either
 * way and carries its reason. A picker that silently drops a provider looks
 * exactly like one that never knew about it, and from the outside you can't tell
 * "no key" from "not wired for this backend".
 *
 * pi is the reason this is a per-backend question rather than a shared one: it
 * reaches credentials the other backends can't see. `pi auth login` writes a
 * stored credential, so an OAuth session you opened months ago in the CLI makes
 * a provider available here with no environment variable involved — and OpenAI
 * arrives two ways, an API key on `openai` or a Codex login on `openai-codex`.
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { SCRIPTED } from "./scripted.ts";

/** `DEMO_MODEL=auto` takes the first candidate whose credentials are present. */
export const AUTO = "auto";

export type Candidate = {
  id: string;
  label: string;
  /** Providers that can serve this model, best first — pi may reach one by key and another by login. */
  providers: readonly string[];
  model: string;
};

/** Ordered, and the order is what `auto` walks: OpenAI, then Anthropic, then Google. */
export const CANDIDATES: readonly Candidate[] = [
  {
    id: "openai/gpt-5.6-luna",
    label: "OpenAI · gpt-5.6-luna",
    providers: ["openai", "openai-codex"],
    model: "gpt-5.6-luna",
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Anthropic · claude-opus-5",
    providers: ["anthropic"],
    model: "claude-opus-5",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Google · gemini-3.1-pro-preview",
    providers: ["google"],
    model: "gemini-3.1-pro-preview",
  },
];

const BY_ID = new Map(CANDIDATES.map((candidate) => [candidate.id, candidate]));

export type Entry = {
  id: string;
  label: string;
  available: boolean;
  via: string | null;
  why: string | null;
};

/** How pi says a credential arrived, in words the picker can show. */
function source(runtime: ModelRuntime, provider: string): string {
  const status = runtime.getProviderAuthStatus(provider);
  if (status.source === "environment") return `${provider} env key`;
  if (status.source === "stored") return `${provider} login (pi auth)`;
  return status.label ?? `${provider} ${status.source ?? "credentials"}`;
}

/** The first provider that has both credentials and the model in its catalogue. */
export function servedBy(runtime: ModelRuntime, candidate: Candidate): string | undefined {
  return candidate.providers.find(
    (provider) => runtime.hasConfiguredAuth(provider) && runtime.getModel(provider, candidate.model),
  );
}

export function catalogue(runtime: ModelRuntime, boot: string): Entry[] {
  const entries: Entry[] = [
    { id: SCRIPTED, label: "scripted", available: true, via: "built in", why: null },
  ];
  for (const candidate of CANDIDATES) {
    const provider = servedBy(runtime, candidate);
    entries.push({
      id: candidate.id,
      label: candidate.label,
      available: provider !== undefined,
      via: provider ? source(runtime, provider) : null,
      why: provider ? null : `no credentials for ${candidate.providers.join(" or ")}`,
    });
  }
  // Listed whatever is current: `DEMO_MODEL` takes native spellings the closed
  // set does not, and showing the row only while it happened to be running made
  // leaving it a one-way door — one switch to `scripted` and back meant a restart.
  if (boot !== SCRIPTED && !BY_ID.has(boot))
    entries.push({ id: boot, label: `${boot} · from DEMO_MODEL`, available: true, via: "DEMO_MODEL", why: null });
  return entries;
}

/** Why this id can't be selected, or undefined if it can. The picker is a closed set; `DEMO_MODEL` isn't. */
export function unavailable(runtime: ModelRuntime, boot: string, id: string): string | undefined {
  if (id === SCRIPTED || id === boot) return undefined;
  const candidate = BY_ID.get(id);
  if (!candidate) return `unknown model ${JSON.stringify(id)} — GET /models lists what this backend offers`;
  if (!servedBy(runtime, candidate))
    return `no credentials for ${id} — \`pi auth login --provider ${candidate.providers[0]}\`, or set its env key`;
  return undefined;
}

/** A catalogue id in pi's own `provider/model` spelling; anything else passes through unchanged. */
export function spec(runtime: ModelRuntime, id: string): string {
  const candidate = BY_ID.get(id);
  if (!candidate) return id;
  const provider = servedBy(runtime, candidate) ?? candidate.providers[0]!;
  return `${provider}/${candidate.model}`;
}

/** `DEMO_MODEL` as given, except `auto`, which resolves against what's actually configured. */
export function initial(runtime: ModelRuntime, demoModel: string): string {
  if (demoModel !== AUTO) return demoModel;
  return CANDIDATES.find((candidate) => servedBy(runtime, candidate))?.id ?? SCRIPTED;
}

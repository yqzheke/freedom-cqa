import { isDeepStrictEqual } from "node:util";
import { hash, seed, type State } from "./store";
import type { Dialogue } from "./domain";
import manifest from "./dev-chat-authorization.json";

// Explicit one-time user grant: only the 60 original synthetic DEV texts in
// this exact import, to Groq production GPT-OSS with Inference ZDR verified.
// No grant for calls, PROD, transcript edits, other imports or providers.
export function authorizedDevChat(
  s: State, d: Dialogue, provider: string, model: string | undefined,
  docId: string | undefined, transcriptRevision?: string,
  grant: { importHash: string; documents: Record<string, string> } = manifest,
): boolean {
  if (provider !== "groq" || model !== "openai/gpt-oss-120b" ||
      transcriptRevision || d.channel !== "agent chat" || d.audio_url !== null || !docId)
    return false;
  const expected = grant.documents[docId];
  const doc = s.docs.find(x => x.id === docId && x.group === "DEV");
  const source = s.imports.filter(x => x.group === "DEV").at(-1);
  if (!expected || !doc || !source || source.hash !== grant.importHash ||
      hash(source.raw) !== grant.importHash || hash(d) !== expected ||
      !isDeepStrictEqual(doc.data, d)) return false;
  const raw = source.raw as { data?: { dataset_group_id?: string; records?: Dialogue[] } };
  return raw.data?.dataset_group_id === "DEV" &&
    Array.isArray(raw.data.records) &&
    raw.data.records.some(record => isDeepStrictEqual(record, d));
}
export function freeDialogueAllowed(
  s: State, d: Dialogue, provider: string, model?: string,
  docId?: string, transcriptRevision?: string,
): boolean {
  return seed().docs.some(example => isDeepStrictEqual(example.data, d)) ||
    authorizedDevChat(s, d, provider, model, docId, transcriptRevision);
}

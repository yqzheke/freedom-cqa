import type { Doc, Run } from "./store";
// Latest imported content per source ID, preserving all historical versions.
export function groupChats(docs: Doc[], group: string) {
  const latest = new Map<string, Doc>();
  for (const doc of docs)
    if (doc.group === group && doc.data.channel === "agent chat")
      latest.set(doc.data.conversation_id, doc);
  return [...latest.values()];
}
export function groupProgress(
  docs: Doc[],
  runs: Run[],
  version: string,
  provider: string,
) {
  return docs.map((doc) => ({
    doc,
    run: runs.find(
      (r) =>
        !r.review &&
        r.doc === doc.id &&
        r.version === version &&
        (r.textProvider ?? "gemini") === provider,
    ),
  }));
}

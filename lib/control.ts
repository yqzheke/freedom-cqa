import { groqModel } from "./groq-models";
import { dialogue, envelope } from "./domain";
import type { Doc, Run, State } from "./store";
export function groupDocuments(docs: Doc[], group: string, includeCalls = false) {
  const latest = new Map<string, Doc>();
  for (const doc of docs)
    if (doc.group === group && (includeCalls || doc.data.channel === "agent chat"))
      latest.set(doc.data.conversation_id, doc);
  return [...latest.values()];
}
export function groupChats(docs: Doc[], group: string) {
  return groupDocuments(docs, group);
}
export function batchDocuments(s: State, group: string, dataset: "control" | "dev" | "prod") {
  if (dataset === "control") {
    const docs = groupChats(s.docs, group);
    if (!docs.length || docs.length > 10) throw Error("Выберите группу из одного–десяти чатов");
    return docs;
  }
  const imported = s.imports.filter(i=>i.group===group).at(-1);
  if (!imported) throw Error("Выберите импортированный набор организаторов");
  const records = envelope.parse(imported.raw).data.records;
  const expected = dataset === "dev" ? 65 : 10;
  if (records.length !== expected || records.filter(d=>d.channel==="voice call").length !== (dataset==="dev"?5:0))
    throw Error("Неверный состав: DEV — 60 чатов и 5 звонков; PROD — 10 чатов");
  return records.map(data=>{
    const doc=[...s.docs].reverse().find(d=>d.group===group && JSON.stringify(dialogue.parse(d.data))===JSON.stringify(data));
    if(!doc) throw Error("Не найдена актуальная запись импорта");
    return doc;
  });
}
export function groupProgress(docs: Doc[], runs: Run[], version: string, provider: string, model?: string) {
  return docs.map((doc) => ({doc,run:[...runs].reverse().find(r=>
    !r.review && !r.transcriptRevision && r.doc===doc.id && r.version===version &&
    (!model || doc.data.channel === "voice call" || (r.textModel ?? groqModel) === model) &&
    (r.textProvider??"gemini")===(doc.data.channel==="voice call"?"gemini":provider))}));
}

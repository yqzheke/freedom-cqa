import { z } from "zod";
import type { Dialogue } from "./domain";
import type { State } from "./store";
export type TranscriptRevision = { id: string; doc: string; created: string; reason: string; original: string; texts: string[] };
const input = z.object({ doc: z.string(), reason: z.string().trim().min(1).max(2000), texts: z.array(z.string().trim().min(1).max(20000)).min(1).max(10000) }).strict();
export function saveTranscriptRevision(s: State, raw: unknown): TranscriptRevision {
 const b = input.parse(raw), doc = s.docs.find(d => d.id === b.doc);
 if (!doc || doc.data.channel !== "voice call") throw Error("Редактирование доступно только для звонка");
 if (b.texts.length !== doc.data.transcript.length) throw Error("Нельзя менять число и номера реплик");
 if (b.texts.every((t,i) => t === doc.data.transcript[i].text)) throw Error("Нет изменений относительно оригинала");
 const revision = {id: crypto.randomUUID(), doc: doc.id, created: new Date().toISOString(), reason: b.reason, original: JSON.stringify(doc.data.transcript), texts: b.texts};
 (s.transcriptRevisions ??= []).push(revision);
 return revision;
}
export function transcriptDialogue(s: Pick<State,"docs"|"transcriptRevisions">, docId: string, revisionId?: string): Dialogue {
 const doc = s.docs.find(d => d.id === docId);
 if (!doc) throw Error("Диалог не найден");
 if (!revisionId) return structuredClone(doc.data);
 const revision = s.transcriptRevisions?.find(r => r.id === revisionId && r.doc === docId);
 if (!revision || revision.original !== JSON.stringify(doc.data.transcript) || revision.texts.length !== doc.data.transcript.length) throw Error("Версия исправлений недоступна или оригинал изменился");
 return {...structuredClone(doc.data), transcript: doc.data.transcript.map((m,i) => ({...m,text:revision.texts[i]}))};
}

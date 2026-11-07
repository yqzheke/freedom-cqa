import { groqModel } from "./groq-models";
import { validateContactEvidence } from "./contact-evidence";
import { z } from "zod";
import { calculate, dialogue, envelope, finding, validateEvidence } from "./domain";
import type { State } from "./store";
const specs = [
  ["contact", "contact", [true, false]],
  ["needs", "discovery", [true, false, null]],
  ["identity", "identification", [true, false, null]],
  ["consult", "consultation", [0, 5, 10, 15, 20, null]],
  ["empathy", "empathy", [true, false]],
  ["flow", "dialogue", [0, 4, 7, 10]],
  ["close", "closure", [true, false, null]],
  ["severe", "critical", [true, false]],
] as const;
export const submissionOptions = z.object({
  group: z.string().min(1), dataset: z.enum(["dev", "prod"]),
  version: z.string().min(1), provider: z.enum(["gemini", "groq"]),
  model: z.string().min(1).optional(),
  teamName: z.string().trim().min(1).max(120), source: z.enum(["original", "current"]),
});
export function buildSubmission(s: State, input: unknown) {
  const o = submissionOptions.parse(input);
  const imported = s.imports.filter(i => i.group === o.group).at(-1);
  if (!imported) throw Error("Выберите импортированный набор организаторов");
  const records = envelope.parse(imported.raw).data.records;
  const expected = o.dataset === "dev" ? 65 : 10;
  if (records.length !== expected || new Set(records.map(d => d.conversation_id)).size !== expected)
    throw Error(`В наборе ${o.dataset} должно быть ровно ${expected} уникальных диалогов`);
  const voices = records.filter(d => d.channel === "voice call").length;
  if (voices !== (o.dataset === "dev" ? 5 : 0)) throw Error("Неверный состав набора: DEV 60 чатов и 5 звонков, PROD 10 чатов");
  const v = s.versions.find(v => v.id === o.version);
  if (!v || v.r.criteria.length !== 8 || specs.some(([id]) => !v.r.criteria.some(c => c.id === id)))
    throw Error("Выберите версию официального чек-листа с восемью критериями");
  if (v.r.round !== "nearest" || v.r.digits !== 2 || v.r.scope !== "global" || v.r.criticalZero)
    throw Error("Для сдачи нужен общий итог, округление до двух знаков и без обнуления за грубую ошибку");
  const modelNames = new Set<string>();
  const results = records.map(data => {
    // Match the exact most recently imported content, never stale historical content.
    const doc = [...s.docs].reverse().find(d => d.group === o.group && JSON.stringify(dialogue.parse(d.data)) === JSON.stringify(data));
    const provider = data.channel === "voice call" ? "gemini" : o.provider;
    const runs = s.runs.filter(r => doc && r.doc === doc.id && r.version === o.version && !r.review && !r.transcriptRevision && (r.textProvider ?? "gemini") === provider && (provider !== "groq" || (r.textModel ?? groqModel) === (o.model ?? groqModel)));
    const run = runs.sort((a,b) => a.created.localeCompare(b.created)).at(-1);
    if (run) for (const c of s.calls.filter(c => c.run === run.id)) modelNames.add(c.model);
    const fail = (error: string) => ({ conversation_id: data.conversation_id, status: "error" as const, criteria: [], score: null, error });
    if (!run || run.status !== "completed") return fail(!run ? "Assessment not started" : "Assessment not completed");
    try {
      const findings = z.array(finding).parse(run[o.source]);
      if (findings.length !== 8 || new Set(findings.map(f => f.id)).size !== 8) throw Error();
      const criteria = specs.map(([id, criterion_id, allowed]) => {
        const f = findings.find(f => f.id === id)!;
        const c = v.r.criteria.find(c => c.id === id)!;
        if (!f || f.status === "review" || !(allowed as readonly unknown[]).includes(f.answer) || (f.status === "na") !== (f.answer === null)) throw Error();
        validateEvidence(data, c, f);
        validateContactEvidence(data, c, f);
        return { criterion_id, value: f.answer, rationale: f.reason, evidence_turns: [...new Set(f.evidence.flatMap(e => Array.from({length:e.to-e.from+1}, (_,i) => e.from+i)))].sort((a,b)=>a-b) };
      });
      const total = calculate(v.r, findings);
      if (total.score === null || !Number.isFinite(total.score) || total.score < 0 || total.score > 100) throw Error();
      const critical = criteria.find(c => c.criterion_id === "critical")!.value;
      if (total.critical !== critical) throw Error();
      return { conversation_id: data.conversation_id, status: "ok" as const, criteria, score: { final_score: total.score, critical_flag: critical as boolean } };
    } catch {
      // Never leak provider bodies, transcripts, URLs or secrets in error entries.
      return fail("Assessment is incomplete or incompatible with the official submission schema");
    }
  });
  return { schema_version: "1.0" as const, team_name: o.teamName, model: { mode: "external_api" as const, name: [...modelNames].sort().join(", ") || "No model invoked" }, results };
}

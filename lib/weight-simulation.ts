import { validateContactEvidence } from "./contact-evidence";
import {
  calculate,
  dialogue,
  envelope,
  finding,
  rubric,
  validateEvidence,
  type Rubric,
} from "./domain";
import type { State, Version } from "./store";

/** Pure preview: never persists weights, findings, runs or published versions. */
export function previewWeights(
  source: Rubric,
  weights: Record<string, number>,
): Rubric {
  rubric.parse(source);
  if (
    Object.keys(weights).some(
      (id) => !source.criteria.some((c) => c.id === id && !c.flagFromAnswer),
    )
  )
    throw Error("Можно менять только веса оценочных критериев");
  const r = structuredClone(source);
  for (const c of r.criteria)
    if (Object.hasOwn(weights, c.id)) {
      const w = weights[c.id];
      if (!Number.isFinite(w) || w < 0 || w > 10000)
        throw Error("Вес должен быть числом от 0 до 10000");
      c.weight = w;
    }
  return rubric.parse(r);
}
export function simulateWeights(
  s: State,
  version: Version,
  weights: Record<string, number>,
  group: string,
) {
  const stored = s.versions.find((v) => v.id === version.id);
  if (!stored || JSON.stringify(stored.r) !== JSON.stringify(version.r))
    throw Error("Исходная версия изменилась. Обновите страницу");
  const proposed = previewWeights(version.r, weights);
  const latest = new Map<string, (typeof s.docs)[number]>();
  const imported = s.imports.filter((i) => i.group === group).at(-1);
  if (imported) {
    const records = envelope.parse(imported.raw).data.records;
    for (const record of records) {
      const doc = [...s.docs]
        .reverse()
        .find(
          (d) =>
            d.group === group &&
            JSON.stringify(dialogue.parse(d.data)) === JSON.stringify(record),
        );
      if (!doc) throw Error("Актуальные данные импорта недоступны");
      latest.set(doc.data.conversation_id, doc);
    }
  } else {
    for (const d of s.docs)
      if (d.group === group) latest.set(d.data.conversation_id, d);
  }
  const rows = [...latest.values()].map((doc) => {
    const run = [...s.runs]
      .reverse()
      .find(
        (r) =>
          r.doc === doc.id &&
          r.version === version.id &&
          !r.review &&
          !r.transcriptRevision,
      );
    const base = {
      id: doc.id,
      name: doc.data.conversation_id,
      before: null as number | null,
      after: null as number | null,
      delta: null as number | null,
      critical: false,
      reason: "",
    };
    if (!run || run.status !== "completed")
      return { ...base, reason: "Нет завершённой оценки выбранной версии" };
    try {
      const answers = finding.array().parse(run.current);
      if (
        answers.length !== version.r.criteria.length ||
        new Set(answers.map((f) => f.id)).size !== answers.length
      )
        throw Error("Состав ответов не соответствует версии");
      for (const c of version.r.criteria) {
        const f = answers.find((f) => f.id === c.id);
        if (!f || f.status === "review")
          throw Error("Есть критерии без подтверждённой оценки");
        validateEvidence(doc.data, c, f);
        validateContactEvidence(doc.data, c, f);
      }
      const before = calculate(version.r, answers),
        after = calculate(proposed, answers);
      if (before.score === null)
        throw Error("Нет применимых весов исходной оценки");
      return {
        ...base,
        before: before.score,
        after: after.score,
        delta:
          after.score === null
            ? null
            : Number((after.score - before.score).toFixed(4)),
        critical: before.critical,
        reason:
          after.score === null
            ? "Нет применимых положительных весов в сценарии"
            : "",
      };
    } catch {
      return {
        ...base,
        reason:
          "Оценка неполная или доказательства несовместимы с исходными данными",
      };
    }
  });
  return { rows, proposed };
}

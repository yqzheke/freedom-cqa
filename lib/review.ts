import { official } from "./official";
import {
  calculate,
  normalized,
  type Finding,
  type Rubric,
  type Dialogue,
} from "./domain";
import type { State, Run, Appeal } from "./store";

type Lock = {
  id: string;
  answer: Finding["answer"];
  status: Finding["status"];
  critical: boolean;
  reason: string;
};
export type Reassessment = {
  errors?: { at: string; message: string }[];
  parent: string;
  appeal: string;
  revision: number;
  baseline: Finding[];
  locks: Lock[];
  resolution?: "accepted" | "rejected";
  final?: Finding[];
  total?: ReturnType<typeof calculate>;
  resolvedAt?: string;
};
export function prepareReview(s: State, a: Appeal) {
  const parent = s.runs.find((r) => r.id === a.run)!;
  if (!a.action || parent.review) throw Error("Требуется решение проверяющего");
  const prior = s.runs.find((r) => r.review?.appeal === a.id);
  if (prior) return prior;
  const locks = new Map<string, Lock>();
  for (const decision of s.appeals
    .filter((x) => x.run === a.run && x.action)
    .sort((x, y) => (x.decidedAt ?? "").localeCompare(y.decidedAt ?? ""))) {
    const f = parent.current.find((f) => f.id === decision.criterion)!;
    locks.set(f.id, {
      id: f.id,
      answer: f.answer,
      status: f.status,
      critical: f.critical,
      reason: decision.reason,
    });
  }
  // A later appeal may have been opened earlier in the list.
  const fixed = parent.current.find((f) => f.id === a.criterion)!;
  locks.set(fixed.id, {
    id: fixed.id,
    answer: fixed.answer,
    status: fixed.status,
    critical: fixed.critical,
    reason: a.reason,
  });
  const job: Run = {
    id: crypto.randomUUID(),
    doc: parent.doc,
    version: parent.version,
    key: "appeal-" + a.id,
    status: "awaiting_permission",
    created: new Date().toISOString(),
    lease: 0,
    token: "",
    cancel: false,
    error: "",
    original: [],
    current: [],
    review: {
      parent: parent.id,
      appeal: a.id,
      revision: parent.reviewRevision ?? 0,
      baseline: structuredClone(parent.current),
      locks: [...locks.values()],
    },
  };
  s.runs.push(job);
  return job;
}
export function recordDecision(s: State, a: Appeal) {
  const parent = s.runs.find((r) => r.id === a.run)!;
  const rubric = s.versions.find((v) => v.id === parent.version)!.r;
  parent.reviewRevision = (parent.reviewRevision ?? 0) + 1;
  a.human = structuredClone(parent.current.find((f) => f.id === a.criterion)!);
  a.decidedAt = new Date().toISOString();
  a.after = structuredClone(parent.current);
  a.total = calculate(rubric, parent.current);
  prepareReview(s, a);
}
export function proposalRows(job: Run) {
  const review = job.review!;
  return review.baseline.map((before) => {
    const ai = job.original.find((f) => f.id === before.id);
    const locked = review.locks.some((l) => l.id === before.id);
    const changed =
      !!ai &&
      (before.answer !== ai.answer ||
        before.status !== ai.status ||
        before.critical !== ai.critical);
    return { before, ai, locked, changed, final: !locked && ai ? ai : before };
  });
}
export function resolveReview(
  s: State,
  job: Run,
  action: "accepted" | "rejected",
) {
  const review = job.review;
  if (!review || job.status !== "completed" || review.resolution)
    throw Error("Конфликт: предложение недоступно");
  const parent = s.runs.find((r) => r.id === review.parent)!;
  if ((parent.reviewRevision ?? 0) !== review.revision)
    throw Error("Конфликт: уже есть более новое решение");
  const rubric = s.versions.find((v) => v.id === parent.version)!.r;
  if (action === "accepted")
    parent.current = structuredClone(proposalRows(job).map((row) => row.final));
  review.final = structuredClone(parent.current);
  review.total = calculate(rubric, parent.current);
  review.resolution = action;
  review.resolvedAt = new Date().toISOString();
  parent.reviewRevision = (parent.reviewRevision ?? 0) + 1;
}
const tips: Record<string, string> = {
  contact:
    "В первом ответе поздоровайтесь на языке клиента и назовите своё имя.",
  needs:
    "Перед ответом уточните недостающую деталь запроса одним конкретным вопросом.",
  identity:
    "До раскрытия данных подтвердите личность клиента по разрешённой процедуре.",
  consult:
    "Перечислите существенные вопросы клиента и дайте ответ или конкретный следующий шаг по каждому.",
  empathy:
    "Назовите неудобство, которое описал клиент, и предложите следующий шаг по его проблеме.",
  flow: "Разделите ответ на последовательные шаги. Если потребуется ожидание, предупредите клиента.",
  close:
    "Подведите итог или предложите дальнейшую помощь и завершите разговор прощанием.",
  severe:
    "Разберите отмеченный фрагмент с проверяющим и сформулируйте корректный ответ в рамках официального канала.",
};
export function recommendations(r: Rubric, rows: Finding[], d: Dialogue) {
  return rows.flatMap((f) => {
    const c = r.criteria.find((x) => x.id === f.id);
    if (
      !c ||
      f.status !== "applicable" ||
      (!f.critical && (!c.weight || !normalized(c, f)?.lt(1)))
    )
      return [];
    const evidence = f.evidence.filter((e) => {
      const m = d.transcript[e.from - 1];
      return (
        m &&
        e.to >= e.from &&
        e.to <= d.transcript.length &&
        (e.quote
          ? e.from === e.to && m.text.includes(e.quote)
          : !!e.expected.trim())
      );
    });
    if (!evidence.length) return [];
    const action = evidence.find((e) => !e.quote)?.expected;
    return [
      {
        id: c.id,
        title: c.title,
        tip: action
          ? "В указанном фрагменте выполните ожидаемое действие: " + action
          : ((official.criteria.some(
              (o) => o.id === c.id && o.instruction === c.instruction,
            )
              ? tips[c.id]
              : undefined) ?? c.instruction),
        evidence,
      },
    ];
  });
}

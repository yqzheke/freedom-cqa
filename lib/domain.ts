import { z } from "zod";
import Decimal from "decimal.js";
const label = z.string().trim().min(1).max(4000);
export const message = z.object({
  timestamp: label,
  speaker: z.enum(["client", "operator", "bot", "system"]),
  text: z.string().min(1),
});
export const dialogue = z
  .object({
    conversation_id: label,
    channel: z.enum(["agent chat", "voice call"]),
    language: z.enum(["RU", "KZ", "EN"]),
    transcript: z.array(message).min(1),
    audio_url: z.url().nullish(),
  })
  .superRefine((d, c) => {
    for (const m of d.transcript) {
      if (
        !(d.channel === "agent chat"
          ? /^\d+:[0-5]\d$/.test(m.timestamp)
          : /(?:Z|[+-]\d\d:\d\d)$/.test(m.timestamp) &&
            Number.isFinite(Date.parse(m.timestamp)))
      )
        c.addIssue({ code: "custom", message: "Неверная метка времени" });
    }
  });
export const envelope = z
  .object({
    isSuccess: z.literal(true),
    error: z.literal(""),
    data: z.object({
      dataset_group_id: label,
      total_records: z.number().int(),
      records: z.array(dialogue),
    }),
  })
  .refine(
    (e) =>
      e.data.records.length === e.data.total_records &&
      new Set(e.data.records.map((d) => d.conversation_id)).size ===
        e.data.total_records,
    "Количество записей или уникальных ID не совпадает",
  );
const points = z.number().min(0).max(1);
export const criterion = z.object({
  id: label,
  title: label,
  instruction: label,
  weight: z.number().nonnegative(),
  section: z.string(),
  na: z.string(),
  source: z.enum(["transcript", "audio", "both"]),
  critical: z.string(),
  flagFromAnswer: z.boolean().optional(),
  mapping: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("boolean"), yes: points, no: points }),
    z
      .object({
        kind: z.literal("number"),
        min: z.number(),
        max: z.number(),
        descending: z.boolean(),
        levels: z.array(z.number()).min(2).optional(),
      })
      .refine(
        (m) =>
          m.max > m.min &&
          (!m.levels ||
            (m.levels.includes(m.min) &&
              m.levels.includes(m.max) &&
              m.levels.every((n) => n >= m.min && n <= m.max) &&
              new Set(m.levels).size === m.levels.length)),
      ),
    z.object({
      kind: z.literal("choice"),
      choices: z.record(label, points).refine((v) => Object.keys(v).length > 0),
    }),
  ]),
});
export const rubric = z
  .object({
    name: label,
    scope: z.enum(["global", "section"]),
    round: z.enum(["nearest", "floor", "ceil"]),
    digits: z.number().int().min(0).max(4),
    criticalZero: z.boolean(),
    criteria: z.array(criterion).min(1).max(64),
  })
  .refine(
    (r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length,
    "Повтор ID",
  );
export type Rubric = z.infer<typeof rubric>;
export type Criterion = z.infer<typeof criterion>;
export type Dialogue = z.infer<typeof dialogue>;
export const finding = z.object({
  id: z.string(),
  status: z.enum(["applicable", "na", "review"]),
  answer: z.union([z.boolean(), z.number(), z.string(), z.null()]),
  reason: label,
  critical: z.boolean(),
  evidence: z.array(
    z.object({
      from: z.number().int(),
      to: z.number().int(),
      quote: z.string(),
      expected: z.string(),
    }),
  ),
});
export type Finding = z.infer<typeof finding>;
export function normalized(c: Criterion, f: Finding) {
  if (f.critical && !c.critical) throw Error("Критическая ошибка не настроена");
  if (f.status !== "applicable") {
    if (f.answer !== null || f.critical || (f.status === "na" && !c.na.trim()))
      throw Error("Недопустимый статус");
    return null;
  }
  const m = c.mapping,
    a = f.answer;
  if (m.kind === "boolean" && typeof a === "boolean")
    return new Decimal(a ? m.yes : m.no);
  if (
    m.kind === "choice" &&
    typeof a === "string" &&
    Object.hasOwn(m.choices, a)
  )
    return new Decimal(m.choices[a]);
  if (
    m.kind === "number" &&
    typeof a === "number" &&
    a >= m.min &&
    a <= m.max &&
    (!m.levels || m.levels.includes(a))
  ) {
    const v = new Decimal(a).minus(m.min).div(new Decimal(m.max).minus(m.min));
    return m.descending ? new Decimal(1).minus(v) : v;
  }
  throw Error("Ответ вне шкалы");
}
export function validateEvidence(d: Dialogue, c: Criterion, f: Finding) {
  normalized(c, f);
  if (
    f.id !== c.id ||
    (!f.evidence.length && f.status === "applicable" && c.source !== "audio")
  )
    throw Error("Нет доказательства");
  for (const e of f.evidence) {
    const m = d.transcript[e.from - 1];
    if (!m || e.to < e.from || e.to > d.transcript.length)
      throw Error("Неверный диапазон");
    if (e.quote) {
      if (e.from !== e.to)
        throw Error("Цитата должна ссылаться на одну реплику");
      if (f.status !== "na" && !["operator", "system"].includes(m.speaker))
        throw Error("Источник цитаты не подтверждает действие оператора");
      if (!m.text.includes(e.quote))
        throw Error("Цитата не найдена в указанной реплике");
    } else if (!e.expected.trim())
      throw Error("Не указано ожидаемое действие для диапазона");
  }
}
export function calculate(r: Rubric, answers: Finding[]) {
  const rows = r.criteria.map((c) => {
    const f = answers.find((x) => x.id === c.id);
    return { c, f, n: f ? normalized(c, f) : null };
  });
  const sum = (values: Decimal.Value[]) =>
    values.reduce<Decimal>((s, v) => s.plus(v), new Decimal(0));
  const active = rows.filter((x) => x.n !== null);
  const groups = [...new Set(active.map((x) => x.c.section))];
  const nominal = (s: string) =>
    sum(rows.filter((x) => x.c.section === s).map((x) => x.c.weight));
  const weight = (s: string) =>
    sum(active.filter((x) => x.c.section === s).map((x) => x.c.weight));
  const total = sum(active.map((x) => x.c.weight)),
    scopeTotal = sum(groups.filter((s) => weight(s).gt(0)).map(nominal));
  let exactTotal = new Decimal(0);
  const details = rows.map(({ c, n }) => {
    let w = new Decimal(0);
    if (n && c.weight) {
      w =
        r.scope === "global"
          ? new Decimal(c.weight).div(total)
          : new Decimal(c.weight)
              .div(weight(c.section))
              .times(nominal(c.section))
              .div(scopeTotal);
    }
    exactTotal = exactTotal.plus(w.times(n ?? 0).times(100));
    return {
      id: c.id,
      original: c.weight,
      effective: w.times(100).toNumber(),
      normalized: n?.toNumber() ?? null,
      contribution: w
        .times(n ?? 0)
        .times(100)
        .toNumber(),
    };
  });
  const rounded = (n: Decimal) =>
    n
      .toDecimalPlaces(
        r.digits,
        {
          nearest: Decimal.ROUND_HALF_UP,
          floor: Decimal.ROUND_FLOOR,
          ceil: Decimal.ROUND_CEIL,
        }[r.round],
      )
      .toNumber();
  const critical = rows.some(({ c, f }) =>
      c.flagFromAnswer ? f?.answer === true : f?.critical,
    ),
    incomplete = rows.some((x) => !x.f || x.f.status === "review");
  return {
    score:
      incomplete || total.isZero()
        ? null
        : critical && r.criticalZero
          ? 0
          : rounded(exactTotal),
    critical,
    details,
    sections: Object.fromEntries(
      groups.map((s) => [
        s,
        incomplete || weight(s).isZero()
          ? null
          : rounded(
              sum(
                active
                  .filter((x) => x.c.section === s)
                  .map((x) => x.n!.times(x.c.weight)),
              )
                .times(100)
                .div(weight(s)),
            ),
      ]),
    ),
  };
}
export const demo: Rubric = {
  name: "Демонстрационный чек-лист",
  scope: "global",
  round: "nearest",
  digits: 1,
  criticalZero: false,
  criteria: [
    {
      id: "welcome",
      title: "Приветствие",
      instruction: "Поздоровался ли оператор?",
      weight: 60,
      section: "Контакт",
      na: "",
      critical: "",
      source: "transcript",
      mapping: { kind: "boolean", yes: 1, no: 0 },
    },
    {
      id: "steps",
      title: "Следующий шаг",
      instruction: "Объяснил ли оператор следующий шаг?",
      weight: 40,
      section: "Решение",
      na: "Клиент только поздоровался и не задал вопрос.",
      critical: "",
      source: "transcript",
      mapping: { kind: "boolean", yes: 1, no: 0 },
    },
  ],
};

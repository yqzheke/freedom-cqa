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
      quoteSource: z.literal("message_reference").optional(),
      purpose: z.literal("context").optional(),
    }),
  ),
});
export type Finding = z.infer<typeof finding>;
export function normalized(c: Criterion, f: Finding) {
  const answerType = f.answer === null ? "null" : typeof f.answer;
  if (f.status !== "applicable") {
    const problems: string[] = [];
    if (f.status === "na" && !c.na.trim())
      problems.push("NA_FORBIDDEN: чек-лист запрещает N/A");
    if (f.answer !== null)
      problems.push("ANSWER_MUST_BE_NULL: тип ответа " + answerType);
    if (f.critical) problems.push("CRITICAL_MUST_BE_FALSE");
    if (problems.length)
      throw Error("Статус " + f.status + " · " + problems.join(" · "));
    return null;
  }
  if (f.critical && !c.critical)
    throw Error("CRITICAL_FORBIDDEN: флаг критической ошибки не настроен");
  const expectedType =
    c.mapping.kind === "choice"
      ? "string"
      : c.mapping.kind === "number"
        ? "number"
        : "boolean";
  if (answerType !== expectedType)
    throw Error(
      "ANSWER_TYPE: для applicable ожидается " +
        expectedType +
        ", получен " +
        answerType,
    );
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
  throw Error(
    m.kind === "choice"
      ? "CHOICE_NOT_ALLOWED: вариант отсутствует в чек-листе"
      : "NUMBER_NOT_ALLOWED: значение вне шкалы или допустимых ступеней",
  );
}
export function validateEvidence(d: Dialogue, c: Criterion, f: Finding) {
  normalized(c, f);
  if (f.id !== c.id)
    throw Error("EVIDENCE_CRITERION_ID: Finding ID does not match criterion");
  if (!f.evidence.length && (f.status === "applicable" || f.status === "na") && c.source !== "audio")
    throw Error(
      "EVIDENCE_REQUIRED: Нет доказательства. Every applicable or NA answer including false or zero needs evidence. For an absent action provide the inspected message range, quote empty and nonempty expected describing the missing action. Never invent a quote.",
    );
  const hasOperatorQuote = f.evidence.some((e) => {
    const message = d.transcript[e.from - 1];
    return (
      !e.purpose &&
      e.from === e.to &&
      !!e.quote &&
      !!message &&
      ["operator", "system"].includes(message.speaker) &&
      message.text.includes(e.quote)
    );
  });
  for (const e of f.evidence) {
    const m = d.transcript[e.from - 1];
    if (!m || e.to < e.from || e.to > d.transcript.length)
      throw Error("Неверный диапазон");
    if (
      e.quoteSource === "message_reference" &&
      (e.from !== e.to || !e.quote.trim() || e.quote !== m.text)
    )
      throw Error(
        "EVIDENCE_REFERENCE_TEXT: referenced evidence must preserve the entire source message exactly",
      );
    if (
      e.purpose === "context" &&
      (!e.quote || e.from !== e.to || m.speaker !== "client")
    )
      throw Error(
        "EVIDENCE_CONTEXT_ROLE: context must select one exact client message, never replace operator evidence",
      );
    if (e.quote) {
      if (e.from !== e.to)
        throw Error(
          "EVIDENCE_QUOTE_RANGE: Цитата должна ссылаться на одну реплику (from=to). Для нескольких цитат нужны отдельные элементы; для проверенного диапазона quote должен быть пустым, expected — объяснять проверенное условие",
        );
      if (
        f.status !== "na" &&
        !["operator", "system"].includes(m.speaker) &&
        !(e.purpose === "context" && hasOperatorQuote)
      )
        throw Error(
          "Источник цитаты не подтверждает действие оператора. EVIDENCE_CONTEXT_PAIR_REQUIRED: client context needs purpose=context and a separate exact operator or system quote in the same finding",
        );
      if (!m.text.includes(e.quote))
        throw Error(
          "EVIDENCE_QUOTE_NOT_FOUND: Цитата не найдена в указанной реплике; declared=" +
            e.from +
            "; exactMatches=" +
            (d.transcript
              .flatMap((message, index) =>
                message.text.includes(e.quote) ? [index + 1] : [],
              )
              .join(",") || "none") +
            ". Use messageNumber and copy an exact substring of that entry's text. Do not paraphrase or translate.",
        );
    } else if (!e.expected.trim())
      throw Error(
        "EVIDENCE_RANGE_EXPLANATION_REQUIRED: Не указано ожидаемое действие для диапазона. When quote is empty, expected must describe the missing action, checked NA condition, or prohibited acts checked and not found. Do not invent evidence.",
      );
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
          : rounded(
              r.scope === "global"
                ? sum(active.map((x) => x.n!.times(x.c.weight)))
                    .times(100)
                    .div(total)
                : exactTotal,
            ),
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

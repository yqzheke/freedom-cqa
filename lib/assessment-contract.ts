import { z } from "zod";
import { finding, type Criterion, type Rubric } from "./domain";

// Group criteria with identical answer constraints so large custom rubrics do
// not repeat the entire evidence schema once per criterion.
export function assessmentContract(r: Rubric) {
  const groups = new Map<
    string,
    {
      ids: string[];
      status: ("applicable" | "na" | "review")[];
      answer: z.ZodType;
      critical: z.ZodType;
    }
  >();
  function group(
    id: string,
    status: ("applicable" | "na" | "review")[],
    answer: z.ZodType,
    critical: z.ZodType,
  ) {
    const key = JSON.stringify([
      status,
      z.toJSONSchema(answer),
      z.toJSONSchema(critical),
    ]);
    const existing = groups.get(key);
    if (existing) existing.ids.push(id);
    else groups.set(key, { ids: [id], status, answer, critical });
  }
  for (const c of r.criteria) {
    const m = c.mapping;
    if (c.flagFromAnswer && m.kind === "boolean") {
      for (const value of [true, false])
        group(c.id, ["applicable"], z.literal(value), z.literal(value));
    } else {
      const answer =
        m.kind === "boolean"
          ? z.boolean()
          : m.kind === "choice"
            ? z.enum(Object.keys(m.choices))
            : m.levels
              ? z.literal(m.levels)
              : z.number().min(m.min).max(m.max);
      group(
        c.id,
        ["applicable"],
        answer,
        c.critical && !c.flagFromAnswer ? z.boolean() : z.literal(false),
      );
    }
    group(
      c.id,
      c.na.trim() ? ["review", "na"] : ["review"],
      z.null(),
      z.literal(false),
    );
  }
  const variants = Array.from(groups.values(), (g) =>
    finding.extend({
      evidence: z.array(
        finding.shape.evidence.element.omit({ quoteSource: true }),
      ),
      id: z.enum(g.ids),
      status: z.enum(g.status),
      answer: g.answer,
      critical: g.critical,
    }),
  );
  return z.object({
    results: z.array(z.union(variants)).length(r.criteria.length),
  });
}
export function allowedStatuses(c: Criterion) {
  return c.na.trim()
    ? ["applicable", "na", "review"]
    : ["applicable", "review"];
}

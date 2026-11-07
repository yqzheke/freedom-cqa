import { finding, type Finding, type Criterion } from "./domain";
import { schemaLocation } from "./diagnostics";
export type AssessmentDraft = {
  fingerprint: string;
  accepted: Finding[];
  targetIds: string[];
  candidates: Finding[];
  errors: string[];
};
// Collect independent failures; never publish a partial score or silently accept
// extra/duplicate IDs. Candidates contain parsed findings, not raw responses.
export function inspectAssessment(
  value: unknown,
  criteria: Criterion[],
  validate: (c: Criterion, f: Finding) => void,
  resolve: (value: unknown) => unknown = (value) => value,
) {
  const accepted: Finding[] = [],
    candidates: Finding[] = [],
    targetIds: string[] = [],
    errors: string[] = [];
  const rows =
    value && typeof value === "object" && "results" in value
      ? (value as { results: unknown }).results
      : null;
  const invalidEnvelope =
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        !criteria.some((c) => c.id === row.id),
    ) ||
    new Set(rows.map((row) => row.id)).size !== rows.length;
  if (invalidEnvelope)
    return {
      accepted,
      candidates,
      targetIds: criteria.map((c) => c.id),
      errors: [
        "Ошибка ASSESSMENT_IDS: Missing results array, unknown or duplicate criterion ID",
      ],
    };
  for (const c of criteria) {
    const raw = rows.find((row) => row.id === c.id);
    let resolved: unknown;
    try {
      resolved = resolve(raw);
    } catch (error) {
      targetIds.push(c.id);
      errors.push(
        "Критерий " +
          (criteria.indexOf(c) + 1) +
          ": " +
          (error instanceof Error
            ? error.message
            : "EVIDENCE_REFERENCE_INVALID"),
      );
      continue;
    }
    const parsed = finding.safeParse(resolved);
    if (!parsed.success) {
      targetIds.push(c.id);
      errors.push(
        "Критерий " +
          (criteria.indexOf(c) + 1) +
          ": SCHEMA " +
          schemaLocation([
            "results",
            rows.indexOf(raw),
            ...parsed.error.issues[0].path,
          ]) +
          " (" +
          parsed.error.issues[0].code +
          ")",
      );
      continue;
    }
    const f = structuredClone(parsed.data);
    try {
      validate(c, f);
      accepted.push(f);
    } catch (error) {
      candidates.push(parsed.data);
      targetIds.push(c.id);
      errors.push(
        error instanceof Error ? error.message : "Assessment validation failed",
      );
    }
  }
  return { accepted, candidates, targetIds, errors };
}

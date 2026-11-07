import { expect, it } from "vitest";
import { inspectAssessment } from "../../lib/assessment-validation";
import { official } from "../../lib/official";
import { seed } from "../../lib/store";
import { validateEvidence } from "../../lib/domain";
const d = seed().docs[0].data;
const rows = () =>
  official.criteria.map((c) => ({
    id: c.id,
    status: "applicable",
    answer: c.mapping.kind === "number" ? c.mapping.max : c.id !== "severe",
    reason: "fixture",
    critical: false,
    evidence: [{ from: 2, to: 2, quote: d.transcript[1].text, expected: "" }],
  }));
const check = (value: unknown) =>
  inspectAssessment(value, official.criteria, (c, f) =>
    validateEvidence(d, c, f),
  );
it("collects independent failures without losing six valid findings or mutating candidates", () => {
  const r = rows();
  r[0].evidence = [];
  r[5].evidence[0].from = 1;
  const before = structuredClone(r),
    result = check({ results: r });
  expect(result.targetIds).toEqual(["contact", "flow"]);
  expect(result.errors).toHaveLength(2);
  expect(result.accepted).toHaveLength(6);
  expect(result.candidates).toHaveLength(2);
  expect(r).toEqual(before);
});
it.each(["duplicate", "unknown"])(
  "requires full repair for %s IDs without exposing them",
  (kind) => {
    const r = rows();
    r[0].id = kind === "duplicate" ? r[1].id : "private-unknown";
    const result = check({ results: r });
    expect(result.accepted).toEqual([]);
    expect(result.targetIds).toHaveLength(8);
    expect(result.errors.join()).not.toContain("private-unknown");
  },
);
it("isolates malformed and missing findings without retaining arbitrary raw data", () => {
  const r: unknown[] = rows();
  r[0] = { id: "contact", status: "private-value" };
  r.pop();
  const result = check({ results: r });
  expect(result.targetIds).toEqual(["contact", "severe"]);
  expect(result.accepted).toHaveLength(6);
  expect(JSON.stringify(result)).not.toContain("private-value");
});

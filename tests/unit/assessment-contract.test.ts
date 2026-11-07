import { it, expect } from "vitest";
import { assessmentContract } from "../../lib/assessment-contract";
import { official } from "../../lib/official";
import { normalized, calculate, type Finding } from "../../lib/domain";
const c = official.criteria[0];
const base: Finding = {
  id: c.id,
  status: "applicable",
  answer: true,
  critical: false,
  reason: "synthetic",
  evidence: [],
};
const schema = assessmentContract({ ...official, criteria: [c] });
it.each([
  ["na", null, false, "NA_FORBIDDEN"],
  ["na", false, false, "NA_FORBIDDEN.*ANSWER_MUST_BE_NULL"],
  ["review", false, false, "ANSWER_MUST_BE_NULL"],
  ["review", null, true, "CRITICAL_MUST_BE_FALSE"],
  ["applicable", null, false, "ANSWER_TYPE"],
  ["applicable", "private-test-string", false, "ANSWER_TYPE"],
  ["applicable", true, true, "CRITICAL_FORBIDDEN"],
] as const)(
  "rejects contact %s / %s / %s with safe specific diagnosis",
  (status, answer, critical, code) => {
    const f = { ...base, status, answer, critical };
    expect(schema.safeParse({ results: [f] }).success).toBe(false);
    expect(() => normalized(c, f)).toThrow(new RegExp(code));
    try {
      normalized(c, f);
    } catch (e) {
      expect(String(e)).not.toContain("private-test-string");
    }
  },
);
it("accepts yes/no and operational review; review blocks the final score", () => {
  for (const answer of [true, false]) {
    const f = { ...base, answer };
    expect(schema.safeParse({ results: [f] }).success).toBe(true);
    expect(normalized(c, f)?.toNumber()).toBe(Number(answer));
  }
  const f: Finding = { ...base, status: "review", answer: null };
  expect(schema.safeParse({ results: [f] }).success).toBe(true);
  expect(calculate({ ...official, criteria: [c] }, [f]).score).toBeNull();
});
it("uses the selected rubric version for NA, option mappings and scale steps", () => {
  const edited = {
    ...c,
    id: "custom",
    na: "synthetic condition",
    mapping: { kind: "choice" as const, choices: { a: 1, b: 0 } },
  };
  const contract = assessmentContract({ ...official, criteria: [edited] });
  const f = { ...base, id: edited.id };
  for (const answer of ["a", "b"]) {
    expect(contract.safeParse({ results: [{ ...f, answer }] }).success).toBe(
      true,
    );
  }
  expect(
    contract.safeParse({ results: [{ ...f, answer: "unknown" }] }).success,
  ).toBe(false);
  expect(
    contract.safeParse({ results: [{ ...f, status: "na", answer: null }] })
      .success,
  ).toBe(true);
  const flow = official.criteria[5],
    flowSchema = assessmentContract({ ...official, criteria: [flow] });
  expect(
    flowSchema.safeParse({ results: [{ ...base, id: flow.id, answer: 7 }] })
      .success,
  ).toBe(true);
  expect(
    flowSchema.safeParse({ results: [{ ...base, id: flow.id, answer: 8 }] })
      .success,
  ).toBe(false);
});

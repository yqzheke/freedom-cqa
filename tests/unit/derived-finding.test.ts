import { expect, it } from "vitest";
import { validateDerivedFinding } from "../../lib/derived-finding";
import { official } from "../../lib/official";
import { seed } from "../../lib/store";
import type { Finding } from "../../lib/domain";
const d = seed().docs[0].data;
const c = official.criteria.find((c) => c.id === "severe")!;
const base: Finding = {
  id: c.id,
  status: "applicable",
  answer: true,
  critical: false,
  reason: "fixture",
  evidence: [{ from: 2, to: 2, quote: d.transcript[1].text, expected: "" }],
};
it.each([true, false])(
  "derives duplicate critical metadata from a validated boolean %s without changing the assessment",
  (answer) => {
    const input = { ...base, answer, critical: !answer },
      before = structuredClone(input);
    expect(validateDerivedFinding(d, c, input)).toEqual({
      ...before,
      critical: answer,
    });
    expect(input).toEqual(before);
  },
);
it("rejects invalid answers and unsupported evidence instead of legitimizing them with a derived flag", () => {
  for (const input of [
    { ...base, answer: "true" },
    { ...base, evidence: [] },
    { ...base, evidence: [{ ...base.evidence[0], quote: "fabricated" }] },
  ]) {
    const before = structuredClone(input);
    expect(() => validateDerivedFinding(d, c, input)).toThrow();
    expect(input).toEqual(before);
  }
});
it("respects the current custom rubric and does not derive a flag without flagFromAnswer", () => {
  const custom = { ...c, flagFromAnswer: false };
  expect(validateDerivedFinding(d, custom, base)).toEqual(base);
  expect(() => validateDerivedFinding(d, { ...c, critical: "" }, base)).toThrow(
    "FLAG_FROM_ANSWER_CONFIG",
  );
});
it("does not silently fix invalid review metadata or a nonboolean rule", () => {
  expect(() =>
    validateDerivedFinding(d, c, {
      ...base,
      status: "review",
      answer: null,
      critical: true,
    }),
  ).toThrow("CRITICAL_MUST_BE_FALSE");
  const custom = {
    ...c,
    mapping: { kind: "number" as const, min: 0, max: 10, descending: false },
  };
  expect(() =>
    validateDerivedFinding(d, custom, { ...base, answer: 7 }),
  ).toThrow("FLAG_FROM_ANSWER_CONFIG");
});

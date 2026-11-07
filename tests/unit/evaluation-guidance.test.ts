import { expect, it } from "vitest";
import { evaluationGuidance } from "../../lib/evaluation-guidance";
import { official } from "../../lib/official";
import { validateEvidence, type Finding } from "../../lib/domain";
import { seed } from "../../lib/store";

it("decomposes the unchanged official contact criterion without changing its definition", () => {
  const c = structuredClone(official.criteria[0]);
  const before = structuredClone(c);
  const g = evaluationGuidance(c)!;
  expect("requiredChecks" in g && g.requiredChecks).toHaveLength(4);
  expect(JSON.stringify(g)).toContain("both checks pass");
  expect(JSON.stringify(g)).toContain("same response");
  expect(c).toEqual(before);
});
it("does not attach official contact checks to a replaced criterion with the same ID", () => {
  const c = structuredClone(official.criteria[0]);
  c.instruction = "Synthetic custom requirement: greet only";
  expect(evaluationGuidance(c)).toBeUndefined();
});
it.each(["demo-RU", "demo-KZ", "demo-EN"])(
  "rejects missing evidence for both contact answers in %s without changing the finding",
  (id) => {
    const d = seed().docs.find((d) => d.id === id)!.data;
    const c = official.criteria[0];
    for (const answer of [true, false]) {
      const f: Finding = {
        id: c.id,
        status: "applicable",
        answer,
        critical: false,
        reason: "fixture",
        evidence: [],
      };
      const before = structuredClone(f);
      expect(() => validateEvidence(d, c, f)).toThrow("EVIDENCE_REQUIRED");
      expect(f).toEqual(before);
    }
    const f: Finding = {
      id: c.id,
      status: "applicable",
      answer: false,
      critical: false,
      reason: "fixture",
      evidence: [
        {
          from: 2,
          to: 2,
          quote: "",
          expected: "Checked first operator response: introduction absent",
        },
      ],
    };
    expect(() => validateEvidence(d, c, f)).not.toThrow();
  },
);

it("evaluates needs applicability at the initial information boundary without changing the rubric", () => {
  const c = structuredClone(official.criteria.find((c) => c.id === "needs")!);
  const before = structuredClone(c),
    guidance = evaluationGuidance(c)!;
  expect(guidance.requiredChecks).toHaveLength(6);
  const instructions = guidance.requiredChecks.join(" ");
  expect(instructions).toContain(
    "Never treat facts supplied later as initially known",
  );
  expect(instructions).toContain("elicited it and used it before answering");
  expect(instructions).toContain("applicable with true, not na");
  expect(instructions).toContain("answered without clarifying it");
  expect(instructions).toContain("choose applicable with false");
  expect(instructions).toContain(
    "choose na even if the operator asks a redundant question",
  );
  expect(instructions).toContain("use review rather than inventing a fact");
  expect(c).toEqual(before);
});
it.each(["instruction", "na"] as const)(
  "does not apply original needs guidance when a custom version changes %s",
  (field) => {
    const c = structuredClone(official.criteria.find((c) => c.id === "needs")!);
    c[field] = "Custom criterion semantics";
    expect(evaluationGuidance(c)).toBeUndefined();
  },
);

it("keeps flow deductions within its official scope without suppressing independently supported faults", () => {
  const c = structuredClone(official.criteria.find((c) => c.id === "flow")!);
  const before = structuredClone(c),
    g = evaluationGuidance(c)!;
  expect(g.requiredChecks).toHaveLength(5);
  const text = g.requiredChecks.join(" ");
  expect(text).toContain("ясности, связности, порядку ответов");
  expect(text).toContain("сами по себе не являются основанием снижать");
  expect(text).toContain("один эпизод может независимо нарушать");
  expect(text).toContain("Не игнорируй такой реальный сбой");
  expect(text).toContain("Выбирай уровень только по указанной шкале");
  expect(text).toContain(
    "переспрашивать именно из-за формулировок или порядка ответа",
  );
  expect(text).toContain("не превращает этот эпизод в 7");
  expect(text).toContain("новым самостоятельным вопросом клиента");
  expect(text).toContain("Не придумывай эту связь");

  expect(text).toContain("не выдумывай сбой или автоматически ставь максимум");
  expect(c).toEqual(before);
});
it("does not impose official flow boundaries on a redefined custom flow criterion", () => {
  const c = structuredClone(official.criteria.find((c) => c.id === "flow")!);
  c.instruction = "Custom scale explicitly includes tone";
  expect(evaluationGuidance(c)).toBeUndefined();
});

it("requires both closing conditions without treating politeness as a summary", () => {
  const c = structuredClone(official.criteria.find((c) => c.id === "close")!),
    before = structuredClone(c);
  const text = evaluationGuidance(c)!.requiredChecks.join(" ");
  expect(text).toContain("Да требует обе части");
  expect(text).toContain("в разных репликах оператора");
  expect(text).toContain("сами по себе не являются итогом");
  expect(text).toContain("N/A только при подтверждённом обрыве");
  expect(c).toEqual(before);
  c.instruction = "Custom: farewell only";
  expect(evaluationGuidance(c)).toBeUndefined();
});

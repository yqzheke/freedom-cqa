import { describe, it, expect } from "vitest";
import { official } from "../../lib/official";
import {
  calculate,
  normalized,
  rubric,
  validateEvidence,
  demo,
  envelope,
  type Finding,
} from "../../lib/domain";
import { seed } from "../../lib/store";
const findings = (): Finding[] =>
  official.criteria.map((c) => ({
    id: c.id,
    status: "applicable",
    answer: c.mapping.kind === "number" ? c.mapping.max : c.id !== "severe",
    critical: false,
    evidence: [],
    reason: "Тест",
  }));
describe("official chat checklist", () => {
  it("validates and totals 100; critical is an independent flag", () => {
    rubric.parse(official);
    const f = findings();
    f[7].answer = true;
    expect(calculate(official, f)).toMatchObject({
      score: 100,
      critical: true,
    });
  });
  it("redistributes identity weight and uses scale levels: (80 − 4.5)/80", () => {
    const f = findings();
    Object.assign(f[2], { status: "na", answer: null });
    f[5].answer = 7;
    expect(calculate(official, f).score).toBe(94.38);
  });
  it("rejects intermediate steps and forbidden NA", () => {
    const f = findings();
    f[5].answer = 8;
    expect(() => calculate(official, f)).toThrow();
    expect(() =>
      normalized(official.criteria[0], { ...f[0], status: "na", answer: null }),
    ).toThrow();
  });
  it("blocks incomplete totals", () => {
    expect(calculate(official, []).score).toBeNull();
  });
  it("calculates floor, ceil, section redistribution and no applicable weights", () => {
    const r = structuredClone(demo);
    r.criteria[0].mapping = {
      kind: "number",
      min: 1,
      max: 4,
      descending: false,
    };
    r.criteria[0].na = "condition";
    const f = findings().slice(0, 2);
    f.forEach((v, i) => (v.id = r.criteria[i].id));
    f[0].answer = 2;
    Object.assign(f[1], { status: "na", answer: null });
    r.scope = "section";
    r.round = "floor";
    expect(calculate(r, f).score).toBe(33.3);
    r.round = "ceil";
    expect(calculate(r, f).score).toBe(33.4);
    Object.assign(f[0], { status: "na", answer: null });
    expect(calculate(r, f).score).toBeNull();
  });
  it("validates exact quotes, range and system evidence", () => {
    const d = seed().docs[0].data,
      f = findings()[0];
    f.evidence = [
      { from: 2, to: 2, quote: d.transcript[1].text, expected: "" },
    ];
    validateEvidence(d, official.criteria[0], f);
    f.evidence[0].quote = "invented";
    expect(() => validateEvidence(d, official.criteria[0], f)).toThrow();
    Object.assign(f.evidence[0], { quote: "", expected: "Приветствие", to: 8 });
    expect(() => validateEvidence(d, official.criteria[0], f)).toThrow();
  });
  it("rejects duplicates and timestamps without timezone", () => {
    const d = seed().docs[0].data;
    const make = (records: unknown[]) => ({
      error: "",
      isSuccess: true,
      data: {
        total_records: records.length,
        dataset_group_id: "test",
        records,
      },
    });
    expect(envelope.safeParse(make([d, d])).success).toBe(false);
    expect(
      envelope.safeParse(make([{ ...d, channel: "voice call" }])).success,
    ).toBe(false);
  });
});
it("allows exact client context for NA and rejects it as proof of operator performance", () => {
  const d = seed().docs[0].data,
    c = official.criteria[1];
  const f: Finding = {
    id: c.id,
    status: "na",
    answer: null,
    critical: false,
    reason: "test",
    evidence: [{ from: 1, to: 1, quote: d.transcript[0].text, expected: "" }],
  };
  validateEvidence(d, c, f);
  expect(() =>
    validateEvidence(d, c, { ...f, status: "applicable", answer: true }),
  ).toThrow("Источник цитаты");
});

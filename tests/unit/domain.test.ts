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
it.each([
  [2.6749, 2.67],
  [2.675, 2.68],
  [2.6751, 2.68],
  [0.005, 0.01],
  [99.995, 100],
])("rounds final percentage %s half up to %s", (value, expected) => {
  const r = structuredClone(official);
  r.criteria = [
    {
      ...r.criteria[3],
      weight: 3,
      mapping: { kind: "number", min: 0, max: 100, descending: false },
    },
    { ...r.criteria[1], weight: 7 },
  ];
  const a: Finding[] = [
    { ...findings()[3], answer: value },
    { ...findings()[1], status: "na", answer: null },
  ];
  expect(calculate(r, a).score).toBe(expected);
});

it("rejects a quoted multi-message range for NA, without weakening valid range evidence", () => {
  const d = seed().docs[0].data;
  const c = official.criteria[2];
  const f: Finding = {
    id: c.id,
    status: "na",
    answer: null,
    critical: false,
    reason: "Synthetic identification condition",
    evidence: [{ from: 1, to: 2, quote: d.transcript[0].text, expected: "" }],
  };
  expect(() => validateEvidence(d, c, f)).toThrow("EVIDENCE_QUOTE_RANGE");
  const before = structuredClone(f);
  try {
    validateEvidence(d, c, f);
  } catch (error) {
    expect(String(error)).toContain("from=to");
    expect(String(error)).not.toContain(d.transcript[0].text);
  }
  expect(f).toEqual(before);
  f.evidence = [
    {
      from: 1,
      to: 2,
      quote: "",
      expected: "Checked whether identification was required",
    },
  ];
  expect(() => validateEvidence(d, c, f)).not.toThrow();
  f.evidence = d.transcript.map((m, i) => ({
    from: i + 1,
    to: i + 1,
    quote: m.text,
    expected: "",
  }));
  expect(() => validateEvidence(d, c, f)).not.toThrow();
  f.evidence[0].quote = "fabricated quote";
  expect(() => validateEvidence(d, c, f)).toThrow("Цитата не найдена");
  f.evidence = [{ from: 1, to: 2, quote: "", expected: "" }];
  expect(() => validateEvidence(d, c, f)).toThrow(
    "Не указано ожидаемое действие",
  );
});

it("distinguishes a wrong message number from an invented quote without leaking text", () => {
  const d = structuredClone(seed().docs[0].data);
  d.transcript[0].text = "private first fixture";
  d.transcript[1].text = "private second fixture";
  const c = official.criteria[2];
  const f: Finding = {
    id: c.id,
    status: "na",
    answer: null,
    critical: false,
    reason: "fixture",
    evidence: [{ from: 1, to: 1, quote: d.transcript[1].text, expected: "" }],
  };
  const original = structuredClone(f);
  try {
    validateEvidence(d, c, f);
    throw Error("Expected rejection");
  } catch (error) {
    expect(String(error)).toContain("EVIDENCE_QUOTE_NOT_FOUND");
    expect(String(error)).toContain("declared=1; exactMatches=2");
    expect(String(error)).not.toContain("private");
  }
  expect(f).toEqual(original);
  f.evidence[0].quote = "invented fixture";
  expect(() => validateEvidence(d, c, f)).toThrow("exactMatches=none");
  f.evidence[0] = { from: 2, to: 2, quote: d.transcript[1].text, expected: "" };
  expect(() => validateEvidence(d, c, f)).not.toThrow();
});

it.each(["demo-RU", "demo-EN", "demo-KZ"])(
  "requires an explained inspected range for absent severe violations in %s",
  (id) => {
    const d = seed().docs.find((d) => d.id === id)!.data;
    const c = official.criteria.find((c) => c.id === "severe")!;
    const f: Finding = {
      id: c.id,
      status: "applicable",
      answer: false,
      critical: false,
      reason: "Synthetic absence fixture",
      evidence: [{ from: 1, to: d.transcript.length, quote: "", expected: "" }],
    };
    const before = structuredClone(f);
    expect(() => validateEvidence(d, c, f)).toThrow(
      "EVIDENCE_RANGE_EXPLANATION_REQUIRED",
    );
    expect(f).toEqual(before);
    f.evidence[0].expected =
      "Inspected the range for insults, unauthorized paid services and confidential disclosure; none found";
    expect(() => validateEvidence(d, c, f)).not.toThrow();
    // A permitted NA is distinct from review and does not leave the total unresolved.
    const answers = findings();
    const consult = answers.find((a) => a.id === "consult")!;
    consult.status = "na";
    consult.answer = null;
    consult.evidence = [
      {
        from: 1,
        to: d.transcript.length,
        quote: "",
        expected: "Chat ended before a request was formulated",
      },
    ];
    expect(() =>
      validateEvidence(
        d,
        official.criteria.find((c) => c.id === "consult")!,
        consult,
      ),
    ).not.toThrow();
    expect(calculate(official, answers).score).not.toBeNull();
    consult.status = "review";
    expect(calculate(official, answers).score).toBeNull();
  },
);

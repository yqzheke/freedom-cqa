import { official } from "../../lib/official";
import { describe, expect, it } from "vitest";
import { seed, type Run } from "../../lib/store";
import { previewWeights, simulateWeights } from "../../lib/weight-simulation";
function fixture() {
  const s = seed(),
    v = s.versions[0];
  const current = v.r.criteria.map((c, i) => ({
    id: c.id,
    status: "applicable" as const,
    answer: i === 0,
    reason: "fixture",
    critical: false,
    evidence: [
      {
        from: 2,
        to: 2,
        quote: s.docs[0].data.transcript[1].text,
        expected: "",
      },
    ],
  }));
  s.runs.push({
    id: "test",
    doc: "demo-RU",
    version: v.id,
    key: "fixture",
    status: "completed",
    lease: 0,
    token: "",
    original: structuredClone(current),
    current,
    error: "",
    cancel: false,
    created: "2026-11-07",
  } satisfies Run);
  return { s, v };
}
describe("weight preview", () => {
  it("recalculates without mutating source/history and ignores other versions", () => {
    const { s, v } = fixture(),
      before = JSON.stringify(s);
    const out = simulateWeights(s, v, { welcome: 20, steps: 80 }, "DEMO");
    expect(out.rows[0]).toMatchObject({ before: 60, after: 20, delta: -40 });
    expect(out.rows[1].before).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
    expect(
      simulateWeights(s, s.versions[1], {}, "DEMO").rows[0].before,
    ).toBeNull();
  });
  it("redistributes NA and handles zero applicable weight", () => {
    const { s, v } = fixture();
    s.runs[0].current[1] = {
      ...s.runs[0].current[1],
      status: "na",
      answer: null,
    };
    expect(
      simulateWeights(s, v, { welcome: 3, steps: 97 }, "DEMO").rows[0],
    ).toMatchObject({ before: 100, after: 100 });
    expect(
      simulateWeights(s, v, { welcome: 0 }, "DEMO").rows[0].after,
    ).toBeNull();
  });
  it("uses official half-up precision and preserves critical flags", () => {
    const { s, v } = fixture();
    v.r.digits = 2;
    expect(
      simulateWeights(s, v, { welcome: 2.675, steps: 97.325 }, "DEMO").rows[0]
        .after,
    ).toBe(2.68);
  });
  it("rejects invalid weights, flag edits, stale version and invalid evidence", () => {
    const { s, v } = fixture();
    for (const w of [NaN, Infinity, -1, 10001])
      expect(() => previewWeights(v.r, { welcome: w })).toThrow();
    expect(() => previewWeights(v.r, { unknown: 1 })).toThrow();
    const stale = structuredClone(v);
    stale.r.criteria[0].instruction = "changed";
    expect(() => simulateWeights(s, stale, {}, "DEMO")).toThrow();
    s.runs[0].current[0].evidence[0].quote = "wrong";
    expect(simulateWeights(s, v, {}, "DEMO").rows[0].before).toBeNull();
  });
  it("does not fall back from a newer failed run, review or revised transcript", () => {
    const { s, v } = fixture();
    s.runs.push({ ...s.runs[0], id: "new", status: "failed" });
    expect(simulateWeights(s, v, {}, "DEMO").rows[0].before).toBeNull();
    s.runs.pop();
    s.runs[0].transcriptRevision = "edited";
    expect(simulateWeights(s, v, {}, "DEMO").rows[0].before).toBeNull();
  });
  it("excludes review and duplicate results", () => {
    const { s, v } = fixture();
    s.runs[0].current[0].status = "review" as "applicable";
    expect(simulateWeights(s, v, {}, "DEMO").rows[0].before).toBeNull();
    s.runs[0].current = s.runs[0].original.concat(s.runs[0].original);
    expect(simulateWeights(s, v, {}, "DEMO").rows[0].before).toBeNull();
  });
});

it("follows the current import even when an older dataset is reimported", () => {
  const { s, v } = fixture(),
    original = s.docs[0];
  s.docs.push({
    ...structuredClone(original),
    id: "newer-copy",
    data: {
      ...structuredClone(original.data),
      transcript: [
        { timestamp: "00:00", speaker: "client", text: "different" },
      ],
    },
  });
  s.imports.push({
    group: "DEMO",
    hash: "current",
    raw: {
      isSuccess: true,
      error: "",
      data: {
        dataset_group_id: "DEMO",
        total_records: 1,
        records: [original.data],
      },
    },
  });
  expect(simulateWeights(s, v, {}, "DEMO").rows[0]).toMatchObject({
    id: "demo-RU",
    before: 60,
  });
});
it("preserves critical flags and prevents weighting the flag criterion", () => {
  const { s, v } = fixture();
  v.r.criteria[0].critical = "Explicit critical rule";
  s.runs[0].current[0].critical = true;
  expect(simulateWeights(s, v, { welcome: 20 }, "DEMO").rows[0].critical).toBe(
    true,
  );
  v.r.criteria[0].flagFromAnswer = true;
  expect(() => previewWeights(v.r, { welcome: 20 })).toThrow();
});

it("excludes historical bot-only contact evidence without changing saved results or preview weights", () => {
  const { s, v } = fixture();
  v.r = {
    ...structuredClone(official),
    criteria: [structuredClone(official.criteria[0])],
  };
  s.docs[0].data.transcript = [
    { speaker: "client", timestamp: "00:00", text: "Hello" },
    { speaker: "bot", timestamp: "00:01", text: "Welcome" },
    { speaker: "operator", timestamp: "00:02", text: "Hello, my name is Alex" },
  ];
  s.runs[0].current = [
    {
      id: "contact",
      status: "applicable",
      answer: false,
      critical: false,
      reason: "historical fixture",
      evidence: [
        { from: 2, to: 2, quote: "", expected: "Checked first reply" },
      ],
    },
  ];
  const before = JSON.stringify(s);
  const out = simulateWeights(s, v, { contact: 20 }, "DEMO");
  expect(out.rows[0].before).toBeNull();
  expect(out.rows[0].after).toBeNull();
  expect(out.rows[0].reason).toContain("доказательства несовместимы");
  expect(JSON.stringify(s)).toBe(before);
  s.runs[0].current[0].evidence = [
    { from: 3, to: 3, quote: "", expected: "Checked first operator reply" },
  ];
  expect(simulateWeights(s, v, { contact: 20 }, "DEMO").rows[0].before).toBe(0);
});

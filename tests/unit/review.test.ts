import { it, expect } from "vitest";
import { seed, type Run, type Appeal } from "../../lib/store";
import { calculate, type Finding } from "../../lib/domain";
import { official } from "../../lib/official";
import {
  recordDecision,
  resolveReview,
  proposalRows,
  recommendations,
} from "../../lib/review";
function fixture() {
  const s = seed(),
    d = s.docs[0].data;
  const original: Finding[] = official.criteria.map((c) => ({
    id: c.id,
    status: "applicable",
    answer: c.mapping.kind === "number" ? c.mapping.max : c.id !== "severe",
    critical: false,
    reason: "fixture",
    evidence: [{ from: 2, to: 2, quote: d.transcript[1].text, expected: "" }],
  }));
  const parent: Run = {
    id: "parent",
    version: "official-chat-v1",
    doc: s.docs[0].id,
    key: "p",
    status: "completed",
    created: "",
    token: "",
    lease: 0,
    cancel: false,
    error: "",
    original,
    current: structuredClone(original),
  };
  s.runs.push(parent);
  const appeal: Appeal = {
    id: "a",
    run: parent.id,
    criterion: "identity",
    comment: "fixture comment",
    action: "replace",
    reason: "Общий вопрос о тарифе",
    revision: 0,
    previous: structuredClone(original[2]),
  };
  parent.current[2] = {
    ...original[2],
    status: "na",
    answer: null,
    reason: appeal.reason,
  };
  s.appeals.push(appeal);
  recordDecision(s, appeal);
  const job = s.runs[1];
  job.original = structuredClone(original);
  job.original[3].answer = 10;
  job.original[3].reason = "Часть вопроса открыта";
  job.status = "completed";
  return { s, d, parent, appeal, job };
}
it("preserves the human NA, shows disagreement and applies proposals only after review, with official redistribution", () => {
  const { s, parent, appeal, job } = fixture();
  expect(appeal.total?.score).toBe(100);
  expect(proposalRows(job)[2]).toMatchObject({ changed: true, locked: true });
  expect(parent.current[3].answer).toBe(20);
  resolveReview(s, job, "accepted");
  expect(calculate(official, parent.current).score).toBe(87.5);
  const history = JSON.parse(JSON.stringify(s));
  expect(history.runs[0].original[2].answer).toBe(true);
  expect(history.appeals[0].comment).toBe("fixture comment");
  expect(history.appeals[0].human.status).toBe("na");
  expect(history.runs[1].original[2].answer).toBe(true);
  expect(history.runs[1].review.final[2].status).toBe("na");
  expect(history.runs[1].review.total.score).toBe(87.5);
  expect(() => resolveReview(s, job, "accepted")).toThrow();
});
it("rejects a proposal without changing answers and prevents stale proposals overwriting another human decision", () => {
  const a = fixture();
  resolveReview(a.s, a.job, "rejected");
  expect(a.parent.current[3].answer).toBe(20);
  const b = fixture();
  const appeal = {
    ...b.appeal,
    id: "new",
    criterion: "flow",
    reason: "Secondary decision",
    action: "uphold",
  };
  b.s.appeals.push(appeal);
  recordDecision(b.s, appeal);
  expect(() => resolveReview(b.s, b.job, "accepted")).toThrow();
  expect(b.s.runs[2].review?.locks.map((l) => l.id)).toEqual([
    "identity",
    "flow",
  ]);
});
it("returns evidence-backed advice without mutating scores or state", () => {
  const { s, d, parent, job } = fixture();
  resolveReview(s, job, "accepted");
  const before = JSON.stringify(s),
    score = calculate(official, parent.current);
  const advice = recommendations(official, parent.current, d);
  expect(advice.map((a) => a.id)).toEqual(["consult"]);
  expect(advice[0].evidence[0].quote).toBe(d.transcript[1].text);
  expect(JSON.stringify(s)).toBe(before);
  expect(calculate(official, parent.current)).toEqual(score);
});

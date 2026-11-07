import { expect, it } from "vitest";
import { resolveMessageEvidence } from "../../lib/message-evidence";
import { finding, validateEvidence } from "../../lib/domain";
import { official } from "../../lib/official";
import { seed } from "../../lib/store";
const d = () => structuredClone(seed().docs[0].data);
const row = (evidence: unknown[]) => ({
  id: "contact",
  status: "applicable",
  answer: true,
  reason: "fixture",
  critical: false,
  evidence,
});
it.each([
  "Сәлеметсіз бе! Менің атым — Айдана…",
  "Здравствуйте! Меня зовут Анна...",
  "Hello! My name is Anna…",
])("resolves an explicit reference without normalizing text: %s", (text) => {
  const doc = d();
  doc.transcript[1].text = text;
  const raw = row([{ kind: "message", messageNumber: 2 }]),
    before = structuredClone(raw);
  const f = finding.parse(resolveMessageEvidence(raw, doc));
  expect(f.evidence[0]).toEqual({
    from: 2,
    to: 2,
    quote: text,
    expected: "",
    quoteSource: "message_reference",
  });
  expect(() => validateEvidence(doc, official.criteria[0], f)).not.toThrow();
  expect(raw).toEqual(before);
});
it("never substitutes a similar quote or searches another message", () => {
  const doc = d();
  doc.transcript[1].text = "Сәлеметсіз бе! Менің атым Айдана…";
  for (const quote of [
    "сәлеметсіз бе!",
    "Менің атым Айдана...",
    "fabricated",
  ]) {
    const raw = row([{ from: 2, to: 2, quote, expected: "" }]);
    const resolved = resolveMessageEvidence(raw, doc);
    expect(resolved).toEqual(raw);
    expect(() =>
      validateEvidence(doc, official.criteria[0], finding.parse(resolved)),
    ).toThrow("EVIDENCE_QUOTE_NOT_FOUND");
  }
});
it.each([
  { kind: "message", messageNumber: 0 },
  { kind: "message", messageNumber: 999 },
  { kind: "message", messageNumber: 1.5 },
  { kind: "message", messageNumber: 2, quote: "private" },
  { kind: "message", messageNumber: 2, to: 3 },
  { kind: "wrong", messageNumber: 2 },
  {
    from: 2,
    to: 2,
    quote: "private",
    expected: "",
    quoteSource: "message_reference",
  },
])(
  "rejects malformed, mixed or fabricated references without echoing content",
  (item) => {
    expect(() => resolveMessageEvidence(row([item]), d())).toThrow(
      /EVIDENCE_REFERENCE_/,
    );
    try {
      resolveMessageEvidence(row([item]), d());
    } catch (e) {
      expect(String(e)).not.toContain("private");
    }
  },
);
it("preserves speaker checks and rejects empty source messages", () => {
  const doc = d();
  const f = finding.parse(
    resolveMessageEvidence(row([{ kind: "message", messageNumber: 1 }]), doc),
  );
  expect(() => validateEvidence(doc, official.criteria[0], f)).toThrow(
    "Источник цитаты",
  );
  doc.transcript[1].text = " ";
  expect(() =>
    resolveMessageEvidence(row([{ kind: "message", messageNumber: 2 }]), doc),
  ).toThrow("EVIDENCE_REFERENCE_BOUNDS");
});
it("rejects altered persisted reference text instead of repairing it", () => {
  const doc = d();
  const f = finding.parse(
    resolveMessageEvidence(row([{ kind: "message", messageNumber: 2 }]), doc),
  );
  f.evidence[0].quote = doc.transcript[1].text.slice(0, 3);
  expect(() => validateEvidence(doc, official.criteria[0], f)).toThrow(
    "EVIDENCE_REFERENCE_TEXT",
  );
});

it("rejects an empty quote falsely labeled as a source reference", () => {
  const doc = d();
  const f = finding.parse(
    resolveMessageEvidence(row([{ kind: "message", messageNumber: 2 }]), doc),
  );
  f.evidence[0].quote = "";
  f.evidence[0].expected = "private fabricated condition";
  expect(() => validateEvidence(doc, official.criteria[0], f)).toThrow(
    "EVIDENCE_REFERENCE_TEXT",
  );
});

it("accepts explicitly marked exact client context only alongside independent operator evidence", () => {
  const doc = d();
  const raw = row([
    { kind: "message", messageNumber: 2 },
    { kind: "message", messageNumber: 1, purpose: "context" },
  ]);
  const f = finding.parse(resolveMessageEvidence(raw, doc));
  expect(f.evidence[1].quote).toBe(doc.transcript[0].text);
  expect(f.evidence[1].purpose).toBe("context");
  expect(() => validateEvidence(doc, official.criteria[0], f)).not.toThrow();
  f.evidence.shift();
  expect(() => validateEvidence(doc, official.criteria[0], f)).toThrow(
    "EVIDENCE_CONTEXT_PAIR_REQUIRED",
  );
});
it("does not accept unmarked client evidence, fabricated operator support or mislabeled roles", () => {
  const doc = d();
  const paired = finding.parse(
    resolveMessageEvidence(
      row([
        { kind: "message", messageNumber: 2 },
        { kind: "message", messageNumber: 1 },
      ]),
      doc,
    ),
  );
  expect(() => validateEvidence(doc, official.criteria[0], paired)).toThrow(
    "EVIDENCE_CONTEXT_PAIR_REQUIRED",
  );
  paired.evidence[1].purpose = "context";
  paired.evidence[0].quote = "fabricated";
  expect(() => validateEvidence(doc, official.criteria[0], paired)).toThrow();
  const wrongRole = finding.parse(
    resolveMessageEvidence(
      row([{ kind: "message", messageNumber: 2, purpose: "context" }]),
      doc,
    ),
  );
  expect(() => validateEvidence(doc, official.criteria[0], wrongRole)).toThrow(
    "EVIDENCE_CONTEXT_ROLE",
  );
});
it("retains exact quoting and single-message limits for explicit client context", () => {
  const doc = d();
  const f = finding.parse(
    resolveMessageEvidence(
      row([
        { kind: "message", messageNumber: 2 },
        { kind: "message", messageNumber: 1, purpose: "context" },
      ]),
      doc,
    ),
  );
  f.evidence[1].to = 2;
  expect(() => validateEvidence(doc, official.criteria[0], f)).toThrow();
  f.evidence[1].to = 1;
  f.evidence[1].quote = "fabricated context";
  expect(() => validateEvidence(doc, official.criteria[0], f)).toThrow();
});

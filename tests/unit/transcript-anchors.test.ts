import { validateContactEvidence } from "../../lib/contact-evidence";
import { expect, it } from "vitest";
import { transcriptAnchors } from "../../lib/transcript-anchors";
import { validateDerivedFinding } from "../../lib/derived-finding";
import { official } from "../../lib/official";
import { seed } from "../../lib/store";
import type { Finding } from "../../lib/domain";
const c = official.criteria[0];
const doc = () => {
  const d = structuredClone(seed().docs[0].data);
  d.transcript = [
    { speaker: "client", timestamp: "00:00", text: "Hello" },
    { speaker: "bot", timestamp: "00:01", text: "Hello, my name is Bot" },
    { speaker: "system", timestamp: "00:02", text: "Operator connected" },
    { speaker: "operator", timestamp: "00:03", text: "Hello, my name is Alex" },
    { speaker: "operator", timestamp: "00:04", text: "How can I help?" },
  ];
  return d;
};
const f = (answer: boolean): Finding => ({
  id: c.id,
  status: "applicable",
  answer,
  critical: false,
  reason: "fixture",
  evidence: [{ from: 2, to: 2, quote: "", expected: "Checked introduction" }],
});
it("computes role anchors without reading names or mutating the transcript", () => {
  const d = doc(),
    before = structuredClone(d);
  expect(transcriptAnchors(d)).toEqual({
    firstOperatorMessageNumber: 4,
    lastOperatorMessageNumber: 5,
    operatorMessageNumbers: [4, 5],
    botMessageNumbers: [2],
    systemMessageNumbers: [3],
  });
  expect(d).toEqual(before);
  d.transcript = d.transcript.filter((m) => m.speaker !== "operator");
  expect(transcriptAnchors(d).firstOperatorMessageNumber).toBeNull();
});
it("rejects a negative official contact finding based only on an earlier bot range", () => {
  const d = doc(),
    finding = f(false),
    before = structuredClone(finding);
  expect(() => validateDerivedFinding(d, c, finding)).toThrow(
    "CONTACT_FIRST_OPERATOR_REQUIRED",
  );
  expect(finding).toEqual(before);
  finding.evidence[0].from = 4;
  finding.evidence[0].to = 4;
  expect(() => validateDerivedFinding(d, c, finding)).not.toThrow();
});
it("requires first-operator quotation for a positive finding, not a later greeting or an absence range", () => {
  const d = doc(),
    finding = f(true);
  finding.evidence = [
    { from: 4, to: 4, quote: "", expected: "Checked first response" },
  ];
  expect(() => validateDerivedFinding(d, c, finding)).toThrow(
    "CONTACT_FIRST_OPERATOR_QUOTE_REQUIRED",
  );
  finding.evidence = [
    { from: 5, to: 5, quote: d.transcript[4].text, expected: "" },
  ];
  expect(() => validateDerivedFinding(d, c, finding)).toThrow(
    "CONTACT_FIRST_OPERATOR_REQUIRED",
  );
  finding.evidence = [
    { from: 4, to: 4, quote: d.transcript[3].text, expected: "" },
  ];
  expect(validateDerivedFinding(d, c, finding)).toEqual(finding);
});
it("does not invent a missing operator or impose official first-response scope on a custom criterion", () => {
  const d = doc();
  d.transcript = d.transcript.filter((m) => m.speaker !== "operator");
  expect(() => validateDerivedFinding(d, c, f(false))).toThrow(
    "CONTACT_OPERATOR_MISSING",
  );
  const custom = {
    ...c,
    instruction: "Custom criterion checks bot introduction",
  };
  expect(() => validateDerivedFinding(doc(), custom, f(false))).not.toThrow();
});

it("shares a browser-safe source guard independent of property insertion order", () => {
  const d = doc(),
    reordered = { ...c, mapping: { no: 0, yes: 1, kind: "boolean" as const } };
  expect(() => validateContactEvidence(d, reordered, f(false))).toThrow(
    "CONTACT_FIRST_OPERATOR_REQUIRED",
  );
  const custom = { ...reordered, instruction: "Custom contact semantics" };
  expect(() => validateContactEvidence(d, custom, f(false))).not.toThrow();
});

it("retains first-operator evidence scope after weight and presentation changes",()=>{
const changed={...c,weight:50,title:"Renamed contact",section:"New section"};
expect(()=>validateContactEvidence(doc(),changed,f(false))).toThrow("CONTACT_FIRST_OPERATOR_REQUIRED");
});

it("requires an inspected range or quote for N/A instead of silently changing total weight",()=>{
const needs=official.criteria.find(c=>c.id==="needs")!;
const finding:Finding={...f(false),id:"needs",status:"na",answer:null,evidence:[]};
expect(()=>validateDerivedFinding(doc(),needs,finding)).toThrow("EVIDENCE_REQUIRED");
});

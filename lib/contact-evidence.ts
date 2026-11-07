import {
  criterion,
  type Criterion,
  type Dialogue,
  type Finding,
} from "./domain";
import { official } from "./official";
import { transcriptAnchors } from "./transcript-anchors";
// Zod emits the defined object keys in schema order, so input property order
// cannot change the match. No Node imports: shared by server and preview UI.
function matchesOfficialContact(c: Criterion) {
  const parsed = criterion.safeParse(c);
  return (
    parsed.success &&
    JSON.stringify({ ...parsed.data, weight: 0, title: "", section: "" }) ===
      JSON.stringify(
        { ...criterion.parse(official.criteria.find((c) => c.id === "contact")), weight: 0, title: "", section: "" },
      )
  );
}
// Call after validateEvidence. This checks source scope, not semantic correctness.
export function validateContactEvidence(d: Dialogue, c: Criterion, f: Finding) {
  if (f.status === "applicable" && matchesOfficialContact(c)) {
    const first = transcriptAnchors(d).firstOperatorMessageNumber;
    if (first === null)
      throw Error(
        "CONTACT_OPERATOR_MISSING: no operator message; cannot evaluate an operator greeting from bot or system text",
      );
    if (
      !f.evidence.some(
        (e) => e.from <= first && e.to >= first && e.purpose !== "context",
      )
    )
      throw Error(
        "CONTACT_FIRST_OPERATOR_REQUIRED: evidence must inspect first operator messageNumber=" +
          first,
      );
    if (
      f.answer === true &&
      !f.evidence.some(
        (e) =>
          e.from === first &&
          e.to === first &&
          !!e.quote &&
          e.purpose !== "context",
      )
    )
      throw Error(
        "CONTACT_FIRST_OPERATOR_QUOTE_REQUIRED: a positive answer must quote the first operator response, messageNumber=" +
          first,
      );
  }
}

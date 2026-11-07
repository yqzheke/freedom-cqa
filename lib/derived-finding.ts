import { validateContactEvidence } from "./contact-evidence";
import {
  validateEvidence,
  type Criterion,
  type Dialogue,
  type Finding,
} from "./domain";
// Only redundant metadata is derived. The assessment, status and evidence are
// never inferred or rewritten here. The copy is returned only after validation.
export function validateDerivedFinding(
  d: Dialogue,
  c: Criterion,
  input: Finding,
): Finding {
  const result = structuredClone(input);
  if (c.flagFromAnswer) {
    if (c.mapping.kind !== "boolean" || !c.critical.trim())
      throw Error(
        "FLAG_FROM_ANSWER_CONFIG: derived flag requires a boolean criterion with an explicit critical rule",
      );
    if (result.status === "applicable" && typeof result.answer === "boolean")
      result.critical = result.answer;
  }
  validateEvidence(d, c, result);
  validateContactEvidence(d, c, result);

  return result;
}

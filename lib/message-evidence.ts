import { z } from "zod";
import type { Dialogue } from "./domain";
const reference = z
  .object({
    kind: z.literal("message"),
    messageNumber: z.number().int().positive(),
    purpose: z.literal("context").optional(),
  })
  .strict();
// An explicit whole-message selection is not a fuzzy repair of a quote.
// Legacy literal quotes are passed through unchanged and still require exact match.
export function resolveMessageEvidence(raw: unknown, d: Dialogue): unknown {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("evidence" in raw) ||
    !Array.isArray(raw.evidence)
  )
    return raw;
  return {
    ...raw,
    evidence: raw.evidence.map((item: unknown) => {
      if (item && typeof item === "object" && "quoteSource" in item)
        throw Error(
          "EVIDENCE_REFERENCE_PROVENANCE: quoteSource is server-assigned, omit it from model output",
        );
      if (!item || typeof item !== "object" || !("kind" in item)) return item;
      const parsed = reference.safeParse(item);
      if (!parsed.success)
        throw Error(
          "EVIDENCE_REFERENCE_FORMAT: use kind=message, integer messageNumber and optional purpose=context; do not combine a reference with a quote or range",
        );
      const n = parsed.data.messageNumber,
        message = d.transcript[n - 1];
      if (!message || !message.text.trim())
        throw Error(
          "EVIDENCE_REFERENCE_BOUNDS: select an existing nonempty transcript message",
        );
      return {
        from: n,
        to: n,
        quote: message.text,
        expected: "",
        quoteSource: "message_reference",
        ...(parsed.data.purpose ? { purpose: parsed.data.purpose } : {}),
      };
    }),
  };
}

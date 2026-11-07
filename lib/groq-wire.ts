import { z } from "zod";
import { HttpFailure } from "./diagnostics";
// Provider error fields may contain user text. Only emit known protocol values.
const safeValues = {
  code: [
    "json_validate_failed",
    "invalid_request_error",
    "invalid_json_schema",
    "invalid_schema",
    "model_not_found",
    "model_decommissioned",
    "context_length_exceeded",
    "rate_limit_exceeded",
    "invalid_api_key",
    "tool_use_failed",
    "failed_generation",
  ],
  type: [
    "invalid_request_error",
    "invalid_request",
    "validation_error",
    "authentication_error",
    "rate_limit_error",
    "server_error",
    "invalid_api_key",
    "tokens",
    "requests",
  ],
  param: [
    "response_format",
    "response_format.type",
    "response_format.json_schema",
    "response_format.json_schema.schema",
    "response_format.json_schema.strict",
    "messages",
    "model",
    "max_completion_tokens",
    "temperature",
  ],
};
export async function groqFailure(r: Response) {
  const body = await r.json().catch(() => null);
  const fields = z
    .object({
      error: z.object({
        code: z.unknown().optional(),
        type: z.unknown().optional(),
        param: z.unknown().optional(),
      }),
    })
    .safeParse(body);
  const err = new HttpFailure(r.status, "Groq");
  if (fields.success) {
    const parts = (
      Object.keys(safeValues) as (keyof typeof safeValues)[]
    ).flatMap((k) => {
      const v = fields.data.error[k];
      if (v == null) return [];
      return [
        k +
          "=" +
          (typeof v === "string" && safeValues[k].includes(v) ? v : "unknown"),
      ];
    });
    if (parts.length) err.message += " · " + parts.join(" · ");
  }
  return err;
}
// Keep the rubric's enum/union rules in strict mode; descriptive and range
// constraints are enforced by the local validator for every provider.
export function groqSchema(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!("type" in node || "anyOf" in node || "enum" in node || "const" in node))
    throw Error("Неподдерживаемый узел схемы Groq");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties")
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, Record<string, unknown>>).map(
          ([name, child]) => [name, groqSchema(child)],
        ),
      );
    else if (k === "items") out[k] = groqSchema(v as Record<string, unknown>);
    else if (k === "anyOf")
      out[k] = (v as Record<string, unknown>[]).map(groqSchema);
    else if (k === "const") out.enum = [v];
    else if (["type", "enum", "required", "additionalProperties"].includes(k))
      out[k] = v;
  }
  return out;
}

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
  const numeric = (name: string) => {
    const v = r.headers.get(name);
    return v !== null && /^\d{1,12}$/.test(v) ? Number(v) : undefined;
  };
  for (const [header, label] of [
    ["x-ratelimit-limit-tokens", "Лимит токенов/мин"],
    ["x-ratelimit-remaining-tokens", "Остаток токенов/мин"],
  ]) {
    const n = numeric(header);
    if (n !== undefined) err.message += " · " + label + ": " + n;
  }
  const reset = r.headers.get("x-ratelimit-reset-tokens") ?? "";
  if (reset.length <= 40 && /^(?:\d+(?:\.\d{1,6})?(?:ms|s|m|h|d))+$/.test(reset)) {
    const units: Record<string, number> = { ms: .001, s: 1, m: 60, h: 3600, d: 86400 };
    const seconds = Array.from(reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g))
      .reduce((sum, m) => sum + Number(m[1]) * units[m[2]], 0);
    if (Number.isSafeInteger(Math.ceil(seconds))) err.message += " · Сброс минутного окна через " + Math.ceil(seconds) + " с";
  }
  const retry = numeric("retry-after");
  if (r.status === 429 && retry !== undefined) {
    err.retryAt = Date.now() + retry * 1000;
    err.message += " · Повтор не ранее чем через " + retry + " с (" + new Date(err.retryAt).toISOString() + ")";
  }
  return err;
}

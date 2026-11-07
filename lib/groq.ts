import { explanationLanguage } from "./output-language";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { z } from "zod";
import { groqFailure } from "./groq-wire";
import { ValidationFailure } from "./diagnostics";
export { groqModel } from "./groq-models";
import { groqReasoning } from "./groq-models";
export function configuredProvider(): "gemini" | "groq" {
  const provider = process.env.TEXT_EVALUATION_PROVIDER ?? "gemini";
  if (provider !== "gemini" && provider !== "groq")
    throw Error("Неизвестный текстовый провайдер");
  return provider;
}
export async function localGroqKey() {
  let value = "";
  try {
    value =
      parseEnv(await readFile(".env.local", "utf8")).GROQ_API_KEY?.trim() ?? "";
  } catch {}
  if (!value) throw Error("Требуется GROQ_API_KEY в .env.local");
  return value;
}
const envelope = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      finish_reason: z.string().nullable(),
      message: z.object({ content: z.string().nullable() }),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().optional() })
        .optional(),
    })
    .optional(),
});
export async function groqText(
  key: string,
  model: string,
  instruction: string,
  input: string,
) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            instruction +
            '\nReturn exactly one JSON object with a results array. Each result must have id, status, answer, reason, critical and evidence. For supporting quotation evidence, prefer an explicit whole-message reference: {"kind":"message","messageNumber":2}. Choose the exact supplied messageNumber that supports this finding; the server will quote that entire source message verbatim and check its role. A reference item contains kind and messageNumber, with optional purpose="context" only for a client reply used as supporting context. Never include quote/from/to/expected in a reference. For client context, include a separate exact operator or system quotation/reference in the same finding: a client reply alone does not establish operator action. This permits citing both an operator clarification and the client reply, or an unclear operator answer and the client request to clarify; explain the connection without inventing it. This is an alternative representation to the quote instructions above, not permission to cite an unrelated message. For inspected ranges showing an absent act or NA condition, use integer from and to (one-based inclusive), quote="", and nonempty expected. Legacy exact-quote items with from=to, quote and expected remain supported but are never fuzzy-matched or corrected. Never output quoteSource; that provenance field is assigned by the server. Use the supplied criterion mappings and allowedStatuses. Return compact JSON, no markdown, comments, trailing commas, or text outside the object. Keep each reason and expected explanation to one short sentence, and quote only the shortest sufficient exact substring. Escape double quotes and line breaks inside JSON strings. Do not repeat the input rubric or transcript. Example of the shape only (replace every placeholder and assess every supplied criterion): {"results":[{"id":"criterion-id","status":"applicable","answer":false,"reason":"Обязательное действие отсутствует","critical":false,"evidence":[{"from":1,"to":2,"quote":"","expected":"Ожидалось обязательное действие"}]}]}' +
            "\n" +
            explanationLanguage,
        },
        { role: "user", content: input },
      ],
      max_completion_tokens: 3000,
      ...groqReasoning(model),
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw await groqFailure(r);
  const parsed = envelope.safeParse(await r.json().catch(() => null));
  if (!parsed.success)
    throw new ValidationFailure("Ошибка структуры ответа Groq");
  const v = parsed.data,
    u = v.usage,
    c = v.choices[0];
  return {
    usage: {
      id: v.id ?? "",
      input: u?.prompt_tokens ?? 0,
      output: u?.completion_tokens ?? 0,
      cached: u?.prompt_tokens_details?.cached_tokens ?? 0,
      audio: 0,
      raw: u ?? null,
    },
    read() {
      if (c?.finish_reason !== "stop")
        throw new ValidationFailure("Неполный ответ Groq");
      try {
        return JSON.parse(c.message.content ?? "");
      } catch {
        throw new ValidationFailure("Ошибка формата ответа Groq: JSON");
      }
    },
  };
}

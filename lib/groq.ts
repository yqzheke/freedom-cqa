import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { z } from "zod";
import { groqFailure, groqSchema } from "./groq-wire";
import { ValidationFailure } from "./diagnostics";
export const groqModel = "qwen/qwen3.8-27b";
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
  schema: Record<string, unknown>,
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
        { role: "system", content: instruction },
        { role: "user", content: input },
      ],
      max_completion_tokens: 3000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "assessment",
          strict: true,
          schema: groqSchema(schema),
        },
      },
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

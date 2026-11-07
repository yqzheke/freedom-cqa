import { HttpFailure, ValidationFailure } from "./diagnostics";
import { z } from "zod";
const response = z.object({
  responseId: z.string().optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
                thought: z.boolean().optional(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
      cachedContentTokenCount: z.number().optional(),
      promptTokensDetails: z
        .array(z.object({ modality: z.string(), tokenCount: z.number() }))
        .optional(),
    })

    .optional(),
});
export class GeminiRateLimit extends HttpFailure {
  constructor() {
    super(429);
  }
}
export const defaultModel = "gemini-3.5-flash";
type Part =
  { text: string } | { inlineData: { mimeType: string; data: string } };
export async function generate(
  model: string,
  instruction: string,
  parts: Part[],
  limit: number,
  schema?: Record<string, unknown>,
) {
  if (!/^gemini-[a-zA-Z0-9.-]+$/.test(model))
    throw Error("Неверное имя модели Gemini");
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          maxOutputTokens: limit,
        },
      }),
    },
  );
  if (res.status === 429) throw new GeminiRateLimit();
  if (!res.ok) throw new HttpFailure(res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ValidationFailure("Ошибка формата ответа Gemini: JSON");
  }
  const envelope = response.safeParse(body);
  if (!envelope.success)
    throw new ValidationFailure("Ошибка формата ответа Gemini: структура");
  return envelope.data;
}
export function usage(v: z.infer<typeof response>) {
  const u = v.usageMetadata;
  return {
    id: v.responseId ?? "",
    input: u?.promptTokenCount ?? 0,
    output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cached: u?.cachedContentTokenCount ?? 0,
    audio:
      u?.promptTokensDetails?.find((x) => x.modality === "AUDIO")?.tokenCount ??
      0,
    raw: u ?? null,
  };
}
export function generatedJSON(v: z.infer<typeof response>) {
  const c = v.candidates?.[0];
  if (c?.finishReason !== "STOP")
    throw new ValidationFailure(
      "Неполный ответ Gemini: " +
        ([
          "MAX_TOKENS",
          "SAFETY",
          "RECITATION",
          "BLOCKLIST",
          "PROHIBITED_CONTENT",
        ].includes(c?.finishReason ?? "")
          ? c!.finishReason
          : "нет завершённого кандидата"),
    );
  try {
    return JSON.parse(
      c.content?.parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("") ?? "",
    );
  } catch {
    throw new ValidationFailure("Неполный ответ Gemini: JSON");
  }
}

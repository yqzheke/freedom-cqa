import type { Call } from "./store";

// A full minute is reserved per request: no tokenizer guess can safely promise
// how many tokens a provider will count. Reported larger usage extends the wait.
export const groqWindowMs = 65_000;
export const groqTokenBudget = 8_000;
export class GroqPacingWait extends Error {
  constructor(public readonly until: number) {
    super("Ожидание лимита скорости Groq. Продолжение автоматически после " + new Date(until).toLocaleTimeString("ru-RU") + ".");
  }
}
export function groqReservationUntil(start: number, usage?: unknown) {
  let tokens = groqTokenBudget;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    const input = u.prompt_tokens, output = u.completion_tokens;
    if (typeof input === "number" && typeof output === "number" &&
        Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0)
      tokens = Math.max(tokens, input + output);
  }
  return start + Math.ceil(tokens / groqTokenBudget * groqWindowMs);
}
export function nextGroqRequestAt(calls: Call[]) {
  return calls.reduce((until, c) => {
    if (c.provider !== "groq") return until;
    const start = Date.parse(c.date);
    if (!Number.isFinite(start)) return until;
    return Math.max(until, c.pacingUntil ?? 0, groqReservationUntil(start, c.usage));
  }, 0);
}

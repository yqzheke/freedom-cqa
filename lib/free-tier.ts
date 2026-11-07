import type { State } from "./store";

export const quotaMessage =
  "Очередь приостановлена: Gemini вернул HTTP 429. Проверьте квоту перед возобновлением.";
export const limitMessage =
  "Достигнут дневной лимит Free Tier. Возобновите очередь после начала следующих суток UTC.";
export function freePolicy(
  model: string,
  provider: "groq" | "gemini" = "gemini",
) {
  if (provider === "groq") {
    const cap = Number(process.env.GROQ_FREE_REQUESTS_PER_DAY ?? 3);
    if (
      model !== "qwen/qwen3.8-27b" ||
      process.env.MAX_CALL_USD !== "0" ||
      process.env.EVALUATION_BUDGET_USD !== "0" ||
      !Number.isSafeInteger(cap) ||
      cap < 1
    )
      throw Error(
        "Проверьте бесплатную модель Groq, нулевые денежные лимиты и дневной лимит",
      );
    return { cap };
  }
  const mode = process.env.GEMINI_BILLING_MODE ?? "budgeted";
  if (mode === "budgeted") return null;
  if (mode !== "free_only") throw Error("Неизвестный режим оплаты Gemini");
  if (
    process.env.MAX_CALL_USD !== "0" ||
    process.env.EVALUATION_BUDGET_USD !== "0"
  )
    throw Error("Для free_only оба долларовых лимита должны равняться 0");
  const allowed = process.env.GEMINI_FREE_MODEL;
  if (allowed !== "gemini-3.5-flash" || model !== allowed)
    throw Error("Модель не разрешена в режиме free_only");
  const cap = Number(process.env.GEMINI_FREE_REQUESTS_PER_DAY);
  if (!Number.isSafeInteger(cap) || cap < 1)
    throw Error("Настройте дневной лимит запросов Gemini");
  return { cap };
}
export function quotaReached(
  state: State,
  cap: number,
  now: string,
  provider: "gemini" | "groq" = "gemini",
) {
  return (
    state.calls.filter(
      (c) =>
        (c.provider ?? "gemini") === provider &&
        c.mode === "free_only" &&
        c.date.slice(0, 10) === now.slice(0, 10),
    ).length >= cap
  );
}

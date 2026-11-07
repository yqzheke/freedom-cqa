import type { Run } from "./store";

export function retryRun(run: Run, expected: unknown) {
  if (expected !== (run.attempt ?? 0))
    throw Error("Конфликт попытки. Обновите карточку.");
  if (["failed", "cancelled"].includes(run.status)) {
    run.status = "queued";
    run.cancel = false;
    run.error = "";
    run.attempt = (run.attempt ?? 0) + 1;
  }
}
export class ValidationFailure extends Error {}
export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    provider: "Gemini" | "Groq" = "Gemini",
  ) {
    super("Ошибка " + provider + ": HTTP " + status);
  }
}
export function schemaLocation(path: PropertyKey[]) {
  const allowed = [
    "results",
    "id",
    "status",
    "answer",
    "reason",
    "critical",
    "evidence",
    "from",
    "to",
    "quote",
    "expected",
    "segments",
    "startSeconds",
    "endSeconds",
    "operatorIdentifiable",
    "criterionId",
    "observation",
    "limitations",
  ];
  return (
    path
      .map((p) =>
        typeof p === "number"
          ? String(p)
          : allowed.includes(String(p))
            ? String(p)
            : "?",
      )
      .join(".") || "root"
  );
}

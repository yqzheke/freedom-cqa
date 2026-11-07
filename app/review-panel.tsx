import type { Appeal, Run } from "../lib/store";
import { calculate, type Finding, type Rubric } from "../lib/domain";
import { proposalRows } from "../lib/review";
function label(f: Finding) {
  return (
    (f.status === "applicable" ? String(f.answer) : f.status.toUpperCase()) +
    (f.critical ? " · грубая ошибка" : "")
  );
}
export function ReviewPanel({
  appeal,
  parent,
  job,
  rubric,
  act,
  busy,
}: {
  appeal: Appeal;
  parent: Run;
  job?: Run;
  rubric: Rubric;
  act: (args: unknown) => Promise<void>;
  busy: boolean;
}) {
  const human = appeal.human ?? appeal.replacement ?? appeal.previous;
  const review = job?.review,
    stale = review && review.revision !== (parent.reviewRevision ?? 0);
  return (
    <div>
      <p>
        {appeal.action} · {appeal.reason}
      </p>
      {human && (
        <p>
          Зафиксированный ответ проверяющего: <strong>{label(human)}</strong>
        </p>
      )}
      {appeal.total && (
        <p>Итог после решения: {appeal.total.score ?? "—"} / 100</p>
      )}
      {(!job || job.status === "awaiting_permission") && !stale && (
        <button
          disabled={busy}
          onClick={() => act({ op: "requestReview", id: appeal.id })}
        >
          Разрешить повторную оценку{" "}
          {parent.textProvider === "groq" ? "Groq" : "Gemini"}
        </button>
      )}
      {job && review && (
        <>
          <p>
            Повторная оценка: {job.status}. {job.error}
          </p>
          {job.status === "failed" && !stale && (
            <button
              disabled={busy}
              onClick={() =>
                act({ op: "retry", id: job.id, attempt: job.attempt ?? 0 })
              }
            >
              Повторить запрос{" "}
              {parent.textProvider === "groq" ? "Groq" : "Gemini"}
            </button>
          )}
          {review.errors?.length ? (
            <details>
              <summary>История ошибок</summary>
              {review.errors.map((e, i) => (
                <p key={i}>
                  {e.at} · {e.message}
                </p>
              ))}
            </details>
          ) : null}
          {job.status === "completed" && (
            <>
              <h3>Предложение AI</h3>
              {proposalRows(job).map(
                ({ before, ai, changed, locked }) =>
                  ai && (
                    <article key={before.id}>
                      <strong>
                        {rubric.criteria.find((c) => c.id === before.id)?.title}
                      </strong>
                      <p>
                        {locked
                          ? changed
                            ? "AI не согласен с решением человека"
                            : "AI подтверждает решение человека"
                          : changed
                            ? "Предложено изменение"
                            : "Баллы без изменений"}
                      </p>
                      <p>
                        {label(before)} → {label(ai)}
                        {locked ? " · оценка человека зафиксирована" : ""}
                      </p>
                      <p>До пересмотра: {before.reason}</p>
                      <p>После пересмотра: {ai.reason}</p>
                      {ai.evidence.map((e, i) => (
                        <blockquote key={i}>
                          #{e.from}–{e.to} · {e.quote || e.expected}
                        </blockquote>
                      ))}
                    </article>
                  ),
              )}
              <p>
                Итог с предложенными изменениями:{" "}
                {calculate(
                  rubric,
                  proposalRows(job).map((row) => row.final),
                ).score ?? "—"}{" "}
                / 100
              </p>
              {!review.resolution && !stale && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act({
                        op: "resolveReview",
                        id: job.id,
                        action: "accepted",
                      })
                    }
                  >
                    Применить к свободным критериям
                  </button>{" "}
                  <button
                    disabled={busy}
                    onClick={() =>
                      act({
                        op: "resolveReview",
                        id: job.id,
                        action: "rejected",
                      })
                    }
                  >
                    Оставить текущие оценки
                  </button>
                </>
              )}
              {review.resolution && (
                <p>
                  {review.resolution === "accepted"
                    ? "Изменения приняты"
                    : "Изменения отклонены"}
                  . Финальный итог: {review.total?.score ?? "—"} / 100
                </p>
              )}
            </>
          )}
          {stale && !review.resolution && (
            <p>
              Есть более новое решение. Это предложение доступно для просмотра.
            </p>
          )}
        </>
      )}
    </div>
  );
}

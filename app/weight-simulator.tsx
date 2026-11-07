"use client";
import { useState } from "react";
import type { State, Version } from "../lib/store";
import { simulateWeights } from "../lib/weight-simulation";
export function WeightSimulator({
  state,
  version,
}: {
  state: State;
  version: Version;
}) {
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [group, setGroup] = useState(state.docs[0]?.group ?? "");
  let result: ReturnType<typeof simulateWeights> | undefined,
    error = "";
  try {
    result = simulateWeights(state, version, weights, group);
  } catch (e) {
    error = e instanceof Error ? e.message : "Ошибка расчёта";
  }
  const eligible = result?.rows.filter((r) => r.before !== null) ?? [];
  const changed = eligible.filter(
    (r) => r.delta !== null && r.delta !== 0,
  ).length;
  const score = (n: number | null) =>
    n === null
      ? "Нет оценки"
      : n.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
  return (
    <section aria-label="Симулятор весов">
      <h2>Что изменится, если…</h2>
      <p className="notice" style={{ display: "block" }}>
        <strong>Предварительная симуляция, не AI-переоценка.</strong> Меняются
        только веса. Смысл критериев, ответы, доказательства, опубликованный
        чек-лист и экспорт остаются прежними. Новые запросы к модели не
        отправляются.
      </p>
      <p>
        Основа: последние завершённые оценки выбранной версии по оригинальным
        диалогам, включая подтверждённые решения человека. Неподтверждённые
        предложения AI не используются. Для изменения смысла критерия нужна
        новая версия и настоящая переоценка.
      </p>
      <label>
        Группа для симуляции
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {[...new Set(state.docs.map((d) => d.group))].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <div className="grid">
        {version.r.criteria
          .filter((c) => !c.flagFromAnswer)
          .map((c) => (
            <label key={c.id}>
              {c.title} · исходный вес {c.weight}
              <input
                aria-label={`Вес: ${c.title}`}
                type="number"
                min="0"
                max="10000"
                step="any"
                value={
                  Number.isNaN(weights[c.id]) ? "" : (weights[c.id] ?? c.weight)
                }
                onChange={(e) =>
                  setWeights({
                    ...weights,
                    [c.id]:
                      e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
      </div>
      <button onClick={() => setWeights({})}>Сбросить сценарий</button>
      <p>
        N/A исключается из применимого веса. Округление и критический флаг
        следуют выбранной версии. Нулевой применимый вес даёт «Нет оценки», а не
        ноль баллов.
      </p>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p role="status">
            Пригодны для расчёта: {eligible.length} из {result.rows.length}.
            Изменился балл: {changed}.
          </p>
          {!result.rows.length && <p>В группе нет диалогов.</p>}
          <div style={{ overflowX: "auto" }}>
            <table className="simulation-table">
              <thead>
                <tr>
                  <th>Диалог</th>
                  <th>До</th>
                  <th>После · прогноз</th>
                  <th>Разница</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{score(r.before)}</td>
                    <td>{score(r.after)}</td>
                    <td>
                      {r.delta === null
                        ? "—"
                        : `${r.delta > 0 ? "+" : ""}${score(r.delta)}`}
                    </td>
                    <td>
                      {r.reason ||
                        (r.critical
                          ? "Критический флаг сохранён"
                          : "Готово · предварительно")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

"use client";
import { useState } from "react";
import { demo, rubric, type Rubric, type Criterion } from "../lib/domain";
export function Editor({
  initial,
  publish,
}: {
  initial: Rubric;
  publish: (r: Rubric) => Promise<void>;
}) {
  const [r, set] = useState<Rubric>(structuredClone(initial)),
    [err, error] = useState("");
  function update(i: number, p: Partial<Criterion>) {
    set({
      ...r,
      criteria: r.criteria.map((c, j) => (j === i ? { ...c, ...p } : c)),
    });
  }
  const field = (
    name: string,
    value: string | number,
    fn: (v: string) => void,
    type = "text",
  ) => (
    <label>
      {name}
      <input type={type} value={value} onChange={(e) => fn(e.target.value)} />
    </label>
  );
  function move(i: number, j: number) {
    const list = [...r.criteria];
    [list[i], list[j]] = [list[j], list[i]];
    set({ ...r, criteria: list });
  }
  return (
    <section>
      <h2>Редактор чек-листа</h2>
      {field("Название версии", r.name, (name) => set({ ...r, name }))}
      <div className="grid">
        <label>
          Перераспределение
          <select
            value={r.scope}
            onChange={(e) =>
              set({ ...r, scope: e.target.value as Rubric["scope"] })
            }
          >
            <option value="global">По всем критериям</option>
            <option value="section">Внутри секции</option>
          </select>
        </label>
        <label>
          Округление
          <select
            value={r.round}
            onChange={(e) =>
              set({ ...r, round: e.target.value as Rubric["round"] })
            }
          >
            {["nearest", "floor", "ceil"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {field(
          "Знаков после запятой",
          r.digits,
          (v) => set({ ...r, digits: Number(v) }),
          "number",
        )}
      </div>
      <label>
        <input
          type="checkbox"
          checked={r.criticalZero}
          onChange={(e) => set({ ...r, criticalZero: e.target.checked })}
        />{" "}
        Обнулять итог при критической ошибке
      </label>
      {r.criteria.map((c, i) => (
        <article key={c.id}>
          <div className="bar">
            <h3>
              {i + 1}. {c.title}
            </h3>
            <button disabled={!i} onClick={() => move(i, i - 1)}>
              ↑
            </button>
            <button
              disabled={i === r.criteria.length - 1}
              onClick={() => move(i, i + 1)}
            >
              ↓
            </button>
            <button
              onClick={() =>
                set({ ...r, criteria: r.criteria.filter((_, j) => j !== i) })
              }
            >
              Удалить
            </button>
          </div>
          <div className="grid">
            {field("Название критерия", c.title, (title) =>
              update(i, { title }),
            )}
            {field("Секция", c.section, (section) => update(i, { section }))}
            {field(
              "Вес",
              c.weight,
              (v) => update(i, { weight: Number(v) }),
              "number",
            )}
          </div>
          {field(
            "Инструкция для оценки оператора",
            c.instruction,
            (instruction) => update(i, { instruction }),
          )}
          {field("Условие N/A (пусто — запрещено)", c.na, (na) =>
            update(i, { na }),
          )}
          {field("Условие критической ошибки", c.critical, (critical) =>
            update(i, { critical }),
          )}
          <div className="grid">
            <label>
              Источник
              <select
                value={c.source}
                onChange={(e) =>
                  update(i, { source: e.target.value as Criterion["source"] })
                }
              >
                {["transcript", "audio", "both"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Тип ответа
              <select
                value={c.mapping.kind}
                onChange={(e) =>
                  update(i, {
                    mapping:
                      e.target.value === "boolean"
                        ? { kind: "boolean", yes: 1, no: 0 }
                        : e.target.value === "number"
                          ? {
                              kind: "number",
                              min: 1,
                              max: 5,
                              descending: false,
                            }
                          : { kind: "choice", choices: { A: 1, B: 0 } },
                  })
                }
              >
                {["boolean", "number", "choice"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          {c.mapping.kind === "choice" ? (
            <label>
              Варианты и баллы (JSON)
              <textarea
                key={JSON.stringify(c.mapping.choices)}
                defaultValue={JSON.stringify(c.mapping.choices)}
                onBlur={(e) => {
                  try {
                    update(i, {
                      mapping: {
                        kind: "choice",
                        choices: JSON.parse(e.target.value),
                      },
                    });
                    error("");
                  } catch {
                    error("Неверный JSON вариантов");
                  }
                }}
              />
            </label>
          ) : (
            <div className="grid">
              {Object.entries(c.mapping)
                .filter(
                  ([k]) => k !== "kind" && k !== "descending" && k !== "levels",
                )
                .map(([k, v]) => (
                  <div key={k}>
                    {field(
                      k,
                      Number(v),
                      (x) =>
                        update(i, {
                          mapping: { ...c.mapping, [k]: Number(x) },
                        }),
                      "number",
                    )}
                  </div>
                ))}
              {c.mapping.kind === "number" && (
                <label>
                  <input
                    type="checkbox"
                    checked={c.mapping.descending}
                    onChange={(e) => {
                      if (c.mapping.kind === "number")
                        update(i, {
                          mapping: {
                            ...c.mapping,
                            descending: e.target.checked,
                          },
                        });
                    }}
                  />
                  Обратная шкала
                </label>
              )}
            </div>
          )}
          {c.mapping.kind === "number" && (
            <label>
              Допустимые ступени через запятую (пусто — любая)
              <input
                defaultValue={c.mapping.levels?.join(",")}
                onBlur={(e) => {
                  if (c.mapping.kind === "number")
                    update(i, {
                      mapping: {
                        ...c.mapping,
                        levels: e.target.value.trim()
                          ? e.target.value.split(",").map(Number)
                          : undefined,
                      },
                    });
                }}
              />
            </label>
          )}
        </article>
      ))}
      <button
        onClick={() =>
          set({
            ...r,
            criteria: [
              ...r.criteria,
              {
                ...structuredClone(demo.criteria[0]),
                id: crypto.randomUUID(),
                title: "Новый критерий",
              },
            ],
          })
        }
      >
        Добавить критерий
      </button>{" "}
      <button
        className="primary"
        onClick={async () => {
          try {
            await publish(rubric.parse(r));
            error("Версия опубликована");
          } catch {
            error("Проверьте конфигурацию");
          }
        }}
      >
        Опубликовать версию
      </button>
      <details>
        <summary>Импорт и экспорт JSON</summary>
        <textarea
          key={JSON.stringify(r)}
          defaultValue={JSON.stringify(r, null, 2)}
          onBlur={(e) => {
            try {
              set(rubric.parse(JSON.parse(e.target.value)));
            } catch {
              error("Неверный чек-лист");
            }
          }}
        />
      </details>
      <p role="status">{err}</p>
    </section>
  );
}

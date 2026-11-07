"use client";
import { useCallback, useEffect, useState } from "react";
import { Observations } from "./observations";
import { Editor } from "./editor";
import { calculate, type Finding, type Criterion } from "../lib/domain";
import type { State } from "../lib/store";
async function post(body: unknown) {
  const r = await fetch("/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error((await r.json()).message);
}
function Answer({
  c,
  f,
  submit,
}: {
  c: Criterion;
  f: Finding;
  submit: (action: string, reason: string, answer: Partial<Finding>) => void;
}) {
  const [reason, set] = useState(""),
    [status, st] = useState(f.status),
    [a, ans] = useState(String(f.answer ?? "")),
    [critical, flag] = useState(f.critical);
  return (
    <div>
      <label>
        Причина решения
        <input value={reason} onChange={(e) => set(e.target.value)} />
      </label>
      <div className="grid">
        <label>
          Статус
          <select
            value={status}
            onChange={(e) => st(e.target.value as Finding["status"])}
          >
            {["applicable", ...(c.na ? ["na"] : []), "review"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Ответ
          {c.mapping.kind === "number" ? (
            <input
              type="number"
              value={a}
              onChange={(e) => ans(e.target.value)}
            />
          ) : (
            <select value={a} onChange={(e) => ans(e.target.value)}>
              <option value="">Выберите</option>
              {(c.mapping.kind === "boolean"
                ? ["true", "false"]
                : Object.keys(c.mapping.choices)
              ).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )}
        </label>
      </div>
      {c.critical && (
        <label>
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => flag(e.target.checked)}
          />
          Критическая ошибка
        </label>
      )}
      <button
        disabled={!reason.trim()}
        onClick={() => submit("uphold", reason, {})}
      >
        Подтвердить
      </button>{" "}
      <button
        disabled={!reason.trim() || (status === "applicable" && !a)}
        onClick={() =>
          submit("replace", reason, {
            status,
            critical,
            answer:
              status !== "applicable"
                ? null
                : c.mapping.kind === "boolean"
                  ? a === "true"
                  : c.mapping.kind === "number"
                    ? Number(a)
                    : a,
          })
        }
      >
        Изменить оценку
      </button>
    </div>
  );
}
export default function Workspace() {
  const [s, set] = useState<State | null>(null),
    [tab, nav] = useState("Диалоги"),
    [doc, select] = useState(""),
    [ver, version] = useState(""),
    [q, search] = useState(""),
    [lang, language] = useState(""),
    [channel, setChannel] = useState(""),
    [msg, notice] = useState(""),
    [group, groupId] = useState("DEV"),
    [json, paste] = useState(""),
    [highlight, mark] = useState([0, 0]),
    [comments, comment] = useState<Record<string, string>>({}),
    [busy, lock] = useState(false);
  const refresh = useCallback(async () => {
    const res = await fetch("/api/workspace", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw Error(data.message);
    set(data);
    select((old) => old || data.docs[0]?.id);
    version((old) => old || data.versions.at(-1).id);
  }, []);
  useEffect(() => {
    (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get("access");
      if (token) {
        history.replaceState(null, "", location.pathname);
        await post({ op: "access", token });
      }
      await refresh();
    })().catch((e) => notice(e.message));
  }, [refresh]);
  const next = s?.queuePause
    ? undefined
    : (s?.runs.find((x) => x.status === "running") ??
      s?.runs.find((x) => x.status === "queued"));
  useEffect(() => {
    if (!next) return;
    const timer = setTimeout(
      () => {
        post({ op: "step", id: next.id })
          .then(refresh)
          .catch((e) => notice(e.message));
      },
      next.status === "running" ? 2000 : 200,
    );
    return () => clearTimeout(timer);
  }, [next, refresh]);
  async function act(body: unknown) {
    lock(true);
    try {
      await post(body);
      await refresh();
      notice("Сохранено");
    } catch (e) {
      notice((e as Error).message);
    } finally {
      lock(false);
    }
  }
  const d = s?.docs.find((x) => x.id === doc),
    v = s?.versions.find((x) => x.id === ver),
    r = s?.runs.find((x) => x.doc === doc && x.version === ver),
    total = v && r ? calculate(v.r, r.current) : null;
  function evidence(from: number, to: number) {
    mark([from, to]);
    document
      .getElementById("m" + from)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const visible =
    s?.docs.filter(
      (x) =>
        (!lang || lang === x.data.language) &&
        (!channel || channel === x.data.channel) &&
        (x.group + " " + x.data.conversation_id)
          .toLowerCase()
          .includes(q.toLowerCase()),
    ) ?? [];
  return (
    <>
      <header>
        <b>
          Freedom <span>/ CQA</span>
        </b>
        <nav>
          {["Диалоги", "Чек-листы", "Апелляции", "Запуски"].map((k) => (
            <button
              aria-current={tab === k ? "page" : undefined}
              key={k}
              onClick={() => nav(k)}
            >
              {k}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <h1>{tab}</h1>
        {msg && (
          <p role="status">
            {msg} <button onClick={() => notice("")}>×</button>
          </p>
        )}
        {!s ? (
          <p>{msg ? "Проверьте доступ и обновите страницу." : "Загрузка…"}</p>
        ) : (
          <>
            {v && (
              <label className="version">
                Версия чек-листа
                <select value={ver} onChange={(e) => version(e.target.value)}>
                  {s.versions.map((x, i) => (
                    <option value={x.id} key={x.id}>
                      v{i + 1} · {x.r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === "Диалоги" && (
              <>
                <details>
                  <summary>Импортировать диалоги</summary>
                  <div className="bar">
                    <input
                      aria-label="Группа"
                      value={group}
                      onChange={(e) => groupId(e.target.value)}
                    />
                    <button
                      disabled={busy}
                      onClick={() => act({ op: "import", group })}
                    >
                      Загрузить из API
                    </button>
                  </div>
                  <label>
                    JSON набора
                    <textarea
                      value={json}
                      onChange={(e) => paste(e.target.value)}
                    />
                  </label>
                  <input
                    aria-label="Файл JSON"
                    type="file"
                    accept=".json"
                    onChange={async (e) =>
                      paste((await e.target.files?.[0]?.text()) ?? "")
                    }
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      try {
                        void act({ op: "import", payload: JSON.parse(json) });
                      } catch {
                        notice("Неверный JSON");
                      }
                    }}
                  >
                    Импорт JSON
                  </button>
                </details>
                <div className="workspace">
                  <aside>
                    <input
                      placeholder="Поиск по ID или набору"
                      value={q}
                      onChange={(e) => search(e.target.value)}
                    />
                    <div className="grid">
                      <select
                        aria-label="Язык"
                        value={lang}
                        onChange={(e) => language(e.target.value)}
                      >
                        <option value="">Все языки</option>
                        {["RU", "KZ", "EN"].map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                      <select
                        aria-label="Канал"
                        value={channel}
                        onChange={(e) => setChannel(e.target.value)}
                      >
                        <option value="">Все каналы</option>
                        <option>agent chat</option>
                        <option>voice call</option>
                      </select>
                    </div>
                    {visible.map((x) => {
                      const run = s.runs.find(
                        (k) => k.doc === x.id && k.version === ver,
                      );
                      const score =
                        run && v ? calculate(v.r, run.current) : null;
                      return (
                        <button
                          className={"item " + (doc === x.id ? "selected" : "")}
                          key={x.id}
                          onClick={() => {
                            select(x.id);
                            mark([0, 0]);
                          }}
                        >
                          <strong>{x.data.conversation_id}</strong>
                          <small>
                            {x.group} · {x.data.language} · {x.data.channel}
                          </small>
                          <small>
                            {run?.status ?? "Без оценки"} {score?.score}{" "}
                            {score?.critical ? "⚑" : ""}
                          </small>
                        </button>
                      );
                    })}
                    {!visible.length && <p>Диалоги не найдены</p>}
                    <button
                      disabled={busy || !visible.length}
                      onClick={async () => {
                        for (const x of visible.slice(0, 3))
                          await act({ op: "start", doc: x.id, version: ver });
                      }}
                    >
                      Оценить первые {Math.min(3, visible.length)}
                    </button>
                  </aside>
                  {d && (
                    <section>
                      <small>
                        {d.group} / {d.data.language}
                      </small>
                      <h2>{d.data.conversation_id}</h2>
                      {d.data.audio_url && (
                        <>
                          <audio
                            controls
                            src={"/api/workspace?audio=" + doc}
                            onError={() =>
                              notice("Не удалось воспроизвести запись")
                            }
                          />
                          <small>Синхронизация с текстом не проверена</small>
                        </>
                      )}
                      {d.data.transcript.map((m, i) => (
                        <article
                          id={"m" + (i + 1)}
                          key={i}
                          className={
                            highlight[0] <= i + 1 && highlight[1] >= i + 1
                              ? "highlight"
                              : ""
                          }
                        >
                          <small>
                            #{i + 1} · {m.speaker} · {m.timestamp}
                          </small>
                          <p>{m.text}</p>
                        </article>
                      ))}
                    </section>
                  )}
                  <section>
                    <h2>Оценка оператора</h2>
                    {!r ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => act({ op: "start", doc, version: ver })}
                      >
                        Запустить оценку
                      </button>
                    ) : (
                      <>
                        <p>
                          {r.status} {r.error}
                        </p>
                        {r.audio && (
                          <details>
                            <summary>
                              Акустические наблюдения · приблизительное время
                            </summary>
                            <Observations value={r.audio.observations} />
                          </details>
                        )}
                        {r.original.length > 0 && v && (
                          <>
                            <strong className="score">
                              {total?.score ?? "—"} / 100
                            </strong>
                            <p>
                              Исходная оценка:{" "}
                              {calculate(v.r, r.original).score ?? "—"} ·
                              Итоговая: {total?.score ?? "—"}
                            </p>
                            {Object.entries(total?.sections ?? {}).map(
                              ([k, n]) => (
                                <small key={k}>
                                  {k}: {n ?? "—"}{" "}
                                </small>
                              ),
                            )}
                            {r.current.map((f, i) => {
                              const c = v.r.criteria.find(
                                  (x) => x.id === f.id,
                                )!,
                                row = total?.details.find((x) => x.id === f.id);
                              return (
                                <article key={f.id}>
                                  <h3>{c.title}</h3>
                                  <b>
                                    {f.status === "applicable"
                                      ? String(f.answer)
                                      : f.status.toUpperCase()}{" "}
                                    {f.critical ? "· Критическая ошибка" : ""}
                                  </b>
                                  <p>{f.reason}</p>
                                  <small>
                                    Вес {c.weight} · Эфф.{" "}
                                    {row?.effective.toFixed(1)}% · Вклад{" "}
                                    {row?.contribution.toFixed(1)}
                                  </small>
                                  {f.evidence.map((e, j) => (
                                    <button
                                      key={j}
                                      className="evidence"
                                      onClick={() => evidence(e.from, e.to)}
                                    >
                                      #{e.from}–{e.to} {e.quote || e.expected}
                                    </button>
                                  ))}
                                  <details>
                                    <summary>Оспорить</summary>
                                    <input
                                      aria-label="Комментарий"
                                      value={comments[i] ?? ""}
                                      onChange={(e) =>
                                        comment({
                                          ...comments,
                                          [i]: e.target.value,
                                        })
                                      }
                                    />
                                    <button
                                      disabled={!comments[i]?.trim() || busy}
                                      onClick={() =>
                                        act({
                                          op: "appeal",
                                          run: r.id,
                                          criterion: f.id,
                                          comment: comments[i],
                                        })
                                      }
                                    >
                                      Подать апелляцию
                                    </button>
                                  </details>
                                </article>
                              );
                            })}
                          </>
                        )}
                      </>
                    )}
                  </section>
                </div>
              </>
            )}
            {tab === "Чек-листы" && v && (
              <Editor
                key={v.id}
                initial={v.r}
                publish={async (r) => {
                  await post({ op: "publish", r });
                  await refresh();
                  const data = await (await fetch("/api/workspace")).json();
                  version(
                    data.versions.find(
                      (x: { r: unknown }) =>
                        JSON.stringify(x.r) === JSON.stringify(r),
                    )?.id ?? data.versions.at(-1).id,
                  );
                }}
              />
            )}
            {tab === "Апелляции" && (
              <section>
                {!s.appeals.length && <p>Открытых апелляций нет</p>}
                {s.appeals.map((a) => {
                  const run = s.runs.find((x) => x.id === a.run)!,
                    c = s.versions
                      .find((x) => x.id === run.version)!
                      .r.criteria.find((x) => x.id === a.criterion)!,
                    f = run.original.find((x) => x.id === a.criterion)!;
                  return (
                    <article key={a.id}>
                      <small>
                        {
                          s.docs.find((x) => x.id === run.doc)?.data
                            .conversation_id
                        }{" "}
                        · {run.version.slice(0, 8)}
                      </small>
                      <h3>{c.title}</h3>
                      <p>
                        Исходный ответ: {String(f.answer)} · {f.reason}
                      </p>
                      {f.evidence.map((e, i) => (
                        <blockquote key={i}>
                          {e.quote || e.expected} (#{e.from}–{e.to})
                        </blockquote>
                      ))}
                      <p>Обращение: {a.comment}</p>
                      {a.action ? (
                        <p>
                          {a.action} · {a.reason}
                        </p>
                      ) : (
                        <Answer
                          c={c}
                          f={run.current.find((x) => x.id === a.criterion)!}
                          submit={(action, reason, answer) =>
                            act({
                              op: "decide",
                              id: a.id,
                              action,
                              reason,
                              answer,
                              revision: s.appeals.filter(
                                (x) => x.run === run.id && x.action,
                              ).length,
                            })
                          }
                        />
                      )}
                    </article>
                  );
                })}
              </section>
            )}
            {tab === "Запуски" && (
              <section>
                <p>Оставьте вкладку открытой для обработки очереди.</p>
                {s.queuePause && (
                  <article role="status">
                    <p>{s.queuePause}</p>
                    <button
                      disabled={busy}
                      onClick={() => act({ op: "resumeQueue" })}
                    >
                      Возобновить очередь
                    </button>
                  </article>
                )}
                <button
                  onClick={() => {
                    const rows = s.runs
                      .filter(
                        (r) => r.version === ver && r.status === "completed",
                      )
                      .map((r) => ({
                        conversation_id: s.docs.find((x) => x.id === r.doc)!
                          .data.conversation_id,
                        score: calculate(v!.r, r.original).score,
                        answers: Object.fromEntries(
                          r.original.map((f) => [
                            f.id,
                            f.status === "na"
                              ? "N/A"
                              : f.status === "review"
                                ? "review"
                                : f.answer,
                          ]),
                        ),
                      }));
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(rows, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "predictions.json";
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Экспорт исходных оценок для сверки
                </button>
                {s.runs.map((k) => (
                  <article key={k.id}>
                    <h3>
                      {s.docs.find((x) => x.id === k.doc)?.data.conversation_id}
                    </h3>
                    <small>
                      {k.created} · {k.status}
                    </small>
                    <p>{k.error}</p>
                    {["queued", "running"].includes(k.status) ? (
                      <button onClick={() => act({ op: "cancel", id: k.id })}>
                        Отменить
                      </button>
                    ) : (
                      ["failed", "cancelled"].includes(k.status) && (
                        <button onClick={() => act({ op: "retry", id: k.id })}>
                          Повторить
                        </button>
                      )
                    )}
                    {s.calls
                      .filter((x) => x.run === k.id)
                      .map((x) => (
                        <p key={x.id}>
                          {x.model} · {x.status} ·{" "}
                          {x.cost === null
                            ? "Стоимость неизвестна"
                            : "$" + x.cost.toFixed(6)}
                        </p>
                      ))}
                  </article>
                ))}
                <p>
                  Расходы проекта:{" "}
                  {s.calls.some((x) => x.cost === null)
                    ? "частично неизвестны · "
                    : ""}
                  ${s.calls.reduce((n, x) => n + (x.cost ?? 0), 0).toFixed(6)}
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

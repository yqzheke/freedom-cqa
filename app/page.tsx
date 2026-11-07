"use client";
import { recoverQueueState } from "../lib/queue-recovery";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { TranscriptEditor } from "./transcript-editor";
import { transcriptDialogue } from "../lib/transcripts";
import { Observations } from "./observations";
import { SubmissionExport } from "./submission-export";
import { groqModel } from "../lib/groq-models";
import { WeightSimulator } from "./weight-simulator";
import { ControlGroup } from "./control-group";
import { ReviewPanel } from "./review-panel";
import { recommendations } from "../lib/review";
import { Editor } from "./editor";
import { calculate, type Finding, type Criterion } from "../lib/domain";
import type { State } from "../lib/store";
const icons: Record<string, string> = {
  "Диалоги": "M4 4h16v12H9l-5 4V4Z",
  "Чек-листы": "M9 5h11M9 12h11M9 19h11M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2",
  "Апелляции": "M12 3 2 8l10 5 10-5-10-5ZM5 11v6l7 4 7-4v-6",
  "Запуски": "m9 5 10 7-10 7V5Z",
};
function NavIcon({ name }: { name: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name] || icons["Диалоги"]} /></svg>;
}
const statusLabel = (value?: string) => ({ completed: "Оценён", failed: "Ошибка", queued: "В очереди", running: "Обработка", cancelled: "Отменён" }[value ?? ""] || "Без оценки");
const speakerLabel: Record<string, string> = { client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система" };
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
  const [s, set] = useState<
      (State & { textProvider: "gemini" | "groq"; textModel?: string }) | null
    >(null),
    [tab, nav] = useState("Диалоги"),
    [doc, select] = useState(""),
    [transcriptSelection, setTranscriptSelection] = useState<{doc:string;id:string}>({doc:"",id:""}),
    [ver, version] = useState(""),
    [q, search] = useState(""),
    [lang, language] = useState(""),
    [channel, setChannel] = useState(""),
    [onlyCritical, setOnlyCritical] = useState(false),
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
    let cancelled = false;
    let stopRecovery: (() => void) | undefined;
    const timer = setTimeout(
      () => {
        post({ op: "step", id: next.id })
          .then(refresh)
          .catch((e) => {
            if (cancelled) return;
            notice(e.message);
            stopRecovery = recoverQueueState(refresh, (error) => notice(error instanceof Error ? error.message : "Connection interrupted"));
          });
      },
      next.status === "running" ? 2000 : Math.max(200, (next.nextAttemptAt ?? 0) - Date.now()),
    );
    return () => { cancelled = true; clearTimeout(timer); stopRecovery?.(); };
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
  const selectedTranscript = transcriptSelection.doc === doc ? transcriptSelection.id : "";
  const d = s?.docs.find((x) => x.id === doc),
    v = s?.versions.find((x) => x.id === ver),
    r = s?.runs.find(
      (x) =>
        !x.review && (x.transcriptRevision ?? "") === selectedTranscript &&
        (x.textProvider !== "groq" || (x.textModel ?? groqModel) === s.textModel) &&
        (x.textProvider ?? "gemini") ===
          (d?.data.channel === "agent chat" ? s.textProvider : "gemini") &&
        x.doc === doc &&
        x.version === ver,
    ),
    total = v && r ? calculate(v.r, r.current) : null;
  const displayedDialogue = s && d ? transcriptDialogue(s,d.id,selectedTranscript) : undefined;
  function evidence(from: number, to: number) {
    mark([from, to]);
    document
      .getElementById("m" + from)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function listRun(id: string, dialogueChannel: string) {
    return s?.runs.find(
      (k) => !k.review && !k.transcriptRevision &&
        (k.textProvider !== "groq" || (k.textModel ?? groqModel) === s.textModel) &&
        (k.textProvider ?? "gemini") === (dialogueChannel === "agent chat" ? s.textProvider : "gemini") &&
        k.doc === id && k.version === ver,
    );
  }
  const visible =
    s?.docs.filter(
      (x) =>
        (!lang || lang === x.data.language) &&
        (!channel || channel === x.data.channel) &&
        (!onlyCritical || (!!v && calculate(v.r, listRun(x.id, x.data.channel)?.current ?? []).critical)) &&
        (x.group + " " + x.data.conversation_id)
          .toLowerCase()
          .includes(q.toLowerCase()),
    ) ?? [];
  return (
    <>
      <header className="app-sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">f<span>.</span></div>
          <div><b>freedom<span>cqa</span></b><small>Качество в каждом диалоге</small></div>
        </div>
        <span className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</span>
        <nav aria-label="Основная навигация">
          {["Диалоги", "Чек-листы", "Симуляция", "Апелляции", "Запуски"].map((k) => (
            <button aria-current={tab === k ? "page" : undefined} key={k} onClick={() => nav(k)}>
              <NavIcon name={k} /><span>{k}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note"><span className="status-dot" />Локальное пространство<small>Проверяйте оценки.<br />Принимайте решения осознанно.</small></div>
        <div className="sidebar-profile"><span className="avatar">QA</span><div><strong>Аналитик качества</strong><small>Рабочая сессия</small></div></div>
      </header>
      <main>
        <div className="page-topline"><span>Рабочее пространство <span className="breadcrumb-slash">/</span> {tab}</span><span className="workspace-badge"><span className="status-dot" /> Freedom CQA</span></div>
        <div className="page-heading"><div><span className="eyebrow">CONVERSATION QUALITY</span><h1>{tab}</h1><p className="page-description">{{"Диалоги":"От разговора к понятной и проверяемой оценке.","Чек-листы":"Единые правила. Гибкие критерии. Прозрачный результат.","Апелляции":"Пересмотр с аргументами и сохранением истории.","Запуски":"Контроль обработки, версий и результатов."}[tab]}</p></div><span className="heading-symbol" aria-hidden="true"><NavIcon name={tab} /></span></div>
        {msg && (
          <p className="notice" role="status">
            {msg} <button aria-label="Закрыть уведомление" onClick={() => notice("")}>×</button>
          </p>
        )}
        {!s ? (
          <p>{msg ? "Проверьте доступ и обновите страницу." : "Загрузка…"}</p>
        ) : (
          <>
            {tab === "Диалоги" && <div className="overview-strip">
              <div><span className="overview-icon"><NavIcon name="Диалоги" /></span><div><small>В пространстве</small><strong>{s.docs.length} <span>диалогов</span></strong></div></div>
              <div><span className="overview-icon"><NavIcon name="Чек-листы" /></span><div><small>В выбранном чек-листе</small><strong>{v?.r.criteria.length ?? 0} <span>критериев</span></strong></div></div>
              <div><span className="overview-icon"><NavIcon name="Апелляции" /></span><div><small>Ждут решения</small><strong>{s.appeals.filter(a => !a.action).length} <span>апелляций</span></strong></div></div>
            </div>}
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
                <details className="import-panel">
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
                  <aside className="dialogue-list" aria-label="Список диалогов">
                    <div className="panel-title"><h2>Все диалоги</h2><span className="count-badge">{visible.length}</span></div>
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
                    <label>
                      <input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} />
                      Только с грубой ошибкой
                    </label>
                    {onlyCritical && <small>По выбранной версии чек-листа и текущему провайдеру, с учётом решений по апелляциям.</small>}
                    {visible.length === 0 && <p role="status">Нет диалогов по выбранным фильтрам.</p>}
                    {visible.map((x) => {
                      const run = listRun(x.id, x.data.channel);
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
                          <span className="item-heading"><strong>{x.data.conversation_id}</strong><span className="language-tag">{x.data.language}</span></span>
                          <small>{x.group} · {x.data.channel === "voice call" ? "Звонок" : "Чат"}</small>
                          <span className="item-footer"><span className={"status-pill status-" + (run?.status ?? "idle")}>{statusLabel(run?.status)}</span><span className={score?.critical ? "critical-text" : "item-score"}>{score?.score !== null && score?.score !== undefined ? score.score.toFixed(2) : ""}{score?.critical ? " ⚑" : ""}</span></span>
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
                    <section className="transcript-panel">
                      <div className="transcript-heading"><span className="eyebrow">АНАЛИЗ РАЗГОВОРА</span><h2>{d.data.conversation_id}</h2><div className="transcript-meta"><span>{d.data.channel === "voice call" ? "Звонок" : "Чат"}</span><span>{d.data.language}</span><span>{d.data.transcript.length} реплик</span></div></div>
                      {d.data.audio_url && (
                        <div className="audio-card">
                          <div className="audio-label"><NavIcon name="Запуски" /><strong>Запись разговора</strong></div>
                          <audio
                            controls
                            src={"/api/workspace?audio=" + doc}
                            onError={() =>
                              notice("Не удалось воспроизвести запись")
                            }
                          />
                          <small>Синхронизация с текстом не проверена</small>
                        </div>
                      )}
                      {d.data.channel === "voice call" && <TranscriptEditor key={d.id} doc={d} revisions={(s.transcriptRevisions ?? []).filter(x=>x.doc===d.id)} selected={selectedTranscript} choose={id=>{setTranscriptSelection({doc:d.id,id});mark([0,0]);}} save={act} busy={busy} />}
                      {displayedDialogue!.transcript.map((m, i) => (
                        <article
                          id={"m" + (i + 1)}
                          data-speaker={m.speaker}
                          key={i}
                          className={
                            highlight[0] <= i + 1 && highlight[1] >= i + 1
                              ? "highlight"
                              : ""
                          }
                        >
                          <small>
                            <strong>{speakerLabel[m.speaker]}</strong><span>#{i + 1} · {m.timestamp}</span>
                          </small>
                          <p>{m.text}</p>
                        </article>
                      ))}
                    </section>
                  )}
                  <section className="evaluation-panel">
                    <div className="panel-title"><h2>Оценка оператора</h2><span className="count-badge">{v?.r.criteria.length ?? 0}</span></div>
                    <small className="provider-label">
                      {d?.data.channel === "agent chat" &&
                      s.textProvider === "groq"
                        ? "Groq / " + (s.textModel ?? groqModel)
                        : "Gemini"}
                    </small>
                    {!r ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => act({ op: "start", doc, version: ver, transcriptRevision: selectedTranscript || undefined })}
                      >
                        Запустить оценку
                      </button>
                    ) : (
                      <>
                        <p>
                          {r.status === "failed"
                            ? "Последняя попытка завершилась ошибкой."
                            : statusLabel(r.status)}{" "}
                          {r.error}
                        </p>
                        {["failed", "cancelled"].includes(r.status) &&
                          (s.queuePause ? (
                            <p>{s.queuePause} Откройте вкладку «Запуски».</p>
                          ) : (
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                act({
                                  op: "retry",
                                  id: r.id,
                                  attempt: r.attempt ?? 0,
                                })
                              }
                            >
                              Повторить оценку
                            </button>
                          ))}
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
                            <div className="score-summary"><div className="score-ring" style={{ "--score": total?.score ?? 0 } as CSSProperties}><div><small>ИТОГОВАЯ ОЦЕНКА</small><strong className="score">
                              {v.r.digits === 2
                                ? (total?.score?.toFixed(2) ?? "—")
                                : (total?.score ?? "—")}{" "}
                              / 100
                            </strong></div></div><p className={total?.critical ? "critical-banner" : "quality-caption"}>{total?.critical ? "Обнаружена грубая ошибка" : total?.score === null ? "Требуется проверка" : "Оценка по выбранному чек-листу"}</p></div>
                            <p className="score-comparison">
                              Исходная оценка:{" "}
                              {v.r.digits === 2
                                ? (calculate(v.r, r.original).score?.toFixed(
                                    2,
                                  ) ?? "—")
                                : (calculate(v.r, r.original).score ??
                                  "—")}{" "}
                              · Итоговая:{" "}
                              {v.r.digits === 2
                                ? (total?.score?.toFixed(2) ?? "—")
                                : (total?.score ?? "—")}
                            </p>
                            {Object.entries(total?.sections ?? {}).map(
                              ([k, n]) => (
                                <small key={k}>
                                  {k}: {n ?? "—"}{" "}
                                </small>
                              ),
                            )}
                            {d &&
                              recommendations(v.r, r.current, displayedDialogue!).length >
                                0 && (
                                <details className="recommendation-panel">
                                  <summary><h3>Рекомендации оператору</h3></summary>
                                  {recommendations(v.r, r.current, displayedDialogue!).map(
                                    (t) => (
                                      <article key={t.id}>
                                        <strong>{t.title}</strong>
                                        <p>{t.tip}</p>
                                        {t.evidence.map((e, i) => (
                                          <button
                                            className="evidence"
                                            key={i}
                                            onClick={() =>
                                              evidence(e.from, e.to)
                                            }
                                          >
                                            #{e.from}–{e.to}{" "}
                                            {e.quote || e.expected}
                                          </button>
                                        ))}
                                      </article>
                                    ),
                                  )}
                                </details>
                              )}
                            {r.current.map((f, i) => {
                              const c = v.r.criteria.find(
                                  (x) => x.id === f.id,
                                )!,
                                row = total?.details.find((x) => x.id === f.id);
                              return (
                                <article className={"criterion-card" + (f.critical ? " is-critical" : "")} key={f.id}>
                                  <div className="criterion-heading"><span className="criterion-number">{i + 1 < 10 ? "0" : ""}{i + 1}</span><h3>{c.title}</h3></div>
                                  <b className={"answer-pill answer-" + (f.status !== "applicable" ? f.status : f.answer === false ? "no" : "yes")}>
                                    {f.status === "applicable" ? typeof f.answer === "boolean" ? f.answer ? "Да" : "Нет" : String(f.answer) : f.status === "na" ? "N/A" : "Нужна проверка"}{" "}
                                    {f.critical ? "· Критическая ошибка" : ""}
                                  </b>
                                  <p>{f.reason}</p>
                                  <small>
                                    Вес {c.weight} · Эфф.{" "}
                                    {row?.effective.toFixed(1)}% · Вклад{" "}
                                    {row?.contribution.toFixed(v.r.digits)}
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
            {tab === "Симуляция" && v && <WeightSimulator key={v.id} state={s} version={v} />}
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
                        <ReviewPanel
                          appeal={a}
                          parent={run}
                          rubric={
                            s.versions.find((v) => v.id === run.version)!.r
                          }
                          job={s.runs.find((j) => j.review?.appeal === a.id)}
                          act={act}
                          busy={busy}
                        />
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
                              parentRevision: run.reviewRevision ?? 0,
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
                {v && (
                  <ControlGroup
                    state={s}
                    version={v}
                    provider={s.textProvider}
                    model={s.textModel}
                    busy={busy}
                    act={act}
                    open={(id) => {
                      select(id);
                      nav("Диалоги");
                    }}
                  />
                )}
                {v && <SubmissionExport state={s} version={v} provider={s.textProvider} model={s.textModel} />}
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
                        (r) =>
                          !r.review &&
                          (r.textProvider ?? "gemini") ===
                            (s.docs.find((d) => d.id === r.doc)?.data
                              .channel === "agent chat"
                              ? s.textProvider
                              : "gemini") &&
                          r.version === ver &&
                          r.status === "completed",
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
                      {k.review ? "Пересмотр после апелляции · " : ""}
                      {k.created} · {k.status}
                    </small>
                    <p>{k.error}</p>
                    {["queued", "running"].includes(k.status) ? (
                      <button onClick={() => act({ op: "cancel", id: k.id })}>
                        Отменить
                      </button>
                    ) : (
                      ["failed", "cancelled"].includes(k.status) && (
                        <button
                          onClick={() =>
                            act({
                              op: "retry",
                              id: k.id,
                              attempt: k.attempt ?? 0,
                            })
                          }
                        >
                          Повторить
                        </button>
                      )
                    )}
                    {s.calls
                      .filter((x) => x.run === k.id)
                      .map((x) => (
                        <p key={x.id}>
                          {x.attempt !== undefined && (
                            <>
                              Попытка {x.attempt + 1} · {x.stage} ·{" "}
                            </>
                          )}
                          {x.model} · {x.status} {x.diagnostic} ·{" "}
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

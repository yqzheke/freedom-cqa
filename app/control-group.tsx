import { useState } from "react";
import { groupChats, groupProgress } from "../lib/control";
import { calculate } from "../lib/domain";
import type { State, Version } from "../lib/store";
export function ControlGroup({
  state,
  version,
  provider,
  busy,
  act,
  open,
}: {
  state: State;
  version: Version;
  provider: string;
  busy: boolean;
  act: (body: unknown) => Promise<void>;
  open: (id: string) => void;
}) {
  const [group, setGroup] = useState("");
  const docs = groupChats(state.docs, group),
    items = groupProgress(docs, state.runs, version.id, provider);
  const missing = items.filter((i) => !i.run).length;
  const finished = items.filter((i) => i.run?.status === "completed").length;
  function download() {
    const rows = items.map(({ doc, run }) => ({
      conversation_id: doc.data.conversation_id,
      version: version.id,
      score: calculate(version.r, run!.original).score,
      answers: Object.fromEntries(
        run!.original.map((f) => [
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
      new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "control-predictions.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details>
      <summary>Контрольная группа</summary>
      <label>
        Набор чатов
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Выберите набор</option>
          {[...new Set(state.docs.map((d) => d.group))].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      {group && (
        <>
          <p>
            {version.r.name} · {provider} · завершено {finished} из{" "}
            {docs.length}
          </p>
          {docs.length > 10 && (
            <p>Для контрольной группы допускается до 10 чатов.</p>
          )}
          {(version.r.round !== "nearest" || version.r.digits !== 2) && (
            <p>Выберите версию с округлением половина вверх до двух знаков.</p>
          )}
          <button
            disabled={
              busy ||
              !!state.queuePause ||
              !missing ||
              docs.length > 10 ||
              version.r.round !== "nearest" ||
              version.r.digits !== 2
            }
            onClick={() =>
              act({ op: "startGroup", group, version: version.id })
            }
          >
            Поставить в очередь по выбранной версии ({missing})
          </button>{" "}
          <button
            disabled={!docs.length || finished !== docs.length}
            onClick={download}
          >
            Скачать оценки по критериям
          </button>
          {state.queuePause && <p>{state.queuePause}</p>}
          {items.map(({ doc, run }) => (
            <p key={doc.id}>
              <button onClick={() => open(doc.id)}>
                {doc.data.conversation_id}
              </button>{" "}
              · {run?.status ?? "Без запуска"} {run?.error}
            </p>
          ))}
        </>
      )}
    </details>
  );
}

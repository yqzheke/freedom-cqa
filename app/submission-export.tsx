"use client";
import { useState } from "react";
import type { State, Version } from "../lib/store";
export function SubmissionExport({state, version, provider, model}: {state: State; version: Version; provider: "gemini" | "groq"; model?: string}) {
  const groups = [...new Set(state.docs.map(d=>d.group))].filter(g=>g!=="DEMO");
  const [group,setGroup]=useState("");
  const [dataset,setDataset]=useState("dev");
  const [teamName,setTeamName]=useState("Aegis");
  const [source,setSource]=useState("original");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  async function exportFile(save: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workspace", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"exportSubmission",group:group||groups[0],dataset,version:version.id,provider,model,teamName,source,save})});
      const result=await response.json();
      if(!response.ok) throw Error(result.message||"Экспорт не выполнен");
      const errors=result.artifact.results.filter((r:{status:string})=>r.status==="error").length;
      if(!save) {
        const url=URL.createObjectURL(new Blob([JSON.stringify(result.artifact,null,2)+"\n"],{type:"application/json;charset=utf-8"}));
        const a=document.createElement("a"); a.href=url; a.download="results.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      setMessage(`${save?"Сохранено":"Скачано"}: ${result.path}. Записей: ${result.artifact.results.length}; ошибок: ${errors}. ${errors?"Не все оценки готовы. ":""}Отправка в GitHub не выполнялась.`);
    } catch(e) {setMessage(e instanceof Error?e.message:"Ошибка экспорта");} finally {setBusy(false);}
  }
  return <details><summary>Официальная сдача: results.json</summary>
    <p>Схема 1.0. DEV: 60 чатов и 5 звонков. PROD: 10 чатов. Неоценённые записи включаются как ошибки, а не выдуманные баллы. Используется выбранная версия чек-листа: {version.r.name}.</p>
    <label>Команда<input value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="Название команды" /></label>
    <label>Набор<select aria-label="Набор" value={group||groups[0]||""} onChange={e=>setGroup(e.target.value)}>{groups.map(g=><option key={g}>{g}</option>)}</select></label>
    <label>Этап<select aria-label="Этап" value={dataset} onChange={e=>setDataset(e.target.value)}><option value="dev">DEV — 65</option><option value="prod">PROD — 10</option></select></label>
    <label>Источник оценок<select aria-label="Источник оценок" value={source} onChange={e=>setSource(e.target.value)}><option value="original">Исходная оценка AI</option><option value="current">Текущая, с подтверждёнными апелляциями</option></select></label>
    <p>Текстовый провайдер: {provider}{model ? ` / ${model}` : ""}. Звонки: Gemini. Сохранение заменяет только выбранный results/{dataset}/results.json.</p>
    <button disabled={busy||!teamName.trim()||!groups.length} onClick={()=>exportFile(false)}>Скачать официальный JSON</button>{" "}
    <button disabled={busy||!teamName.trim()||!groups.length} onClick={()=>exportFile(true)}>Сохранить в results/{dataset}/results.json</button>
    {message&&<p role="status">{message}</p>}
  </details>;
}

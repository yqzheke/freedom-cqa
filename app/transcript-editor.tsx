"use client";
import { useState } from "react";
import type { Doc } from "../lib/store";
import type { TranscriptRevision } from "../lib/transcripts";
export function TranscriptEditor({doc,revisions,selected,choose,save,busy}:{doc:Doc;revisions:TranscriptRevision[];selected:string;choose:(v:string)=>void;save:(b:Record<string,unknown>)=>Promise<void>;busy:boolean}) {
 const [editing,setEditing]=useState(false),[reason,setReason]=useState(""),[texts,setTexts]=useState<string[]>([]);
 const current=revisions.find(r=>r.id===selected);
 return <section className="transcript-corrections">
 <label>Источник транскрипта<select aria-label="Источник транскрипта" value={selected} onChange={e=>{choose(e.target.value);setEditing(false);}}><option value="">Оригинал организаторов</option>{revisions.map((r,i)=><option key={r.id} value={r.id}>Исправление {i+1} · {new Date(r.created).toLocaleString()}</option>)}</select></label>
 <p>{current ? `Ручная версия. Причина: ${current.reason}` : "Исходный транскрипт сохранён без изменений."}</p>
 <small>Выбранная версия используется только для нового одиночного запуска. Официальный экспорт и групповой запуск используют оригинал. Номера, время и роли реплик сохраняются.</small>
 <button type="button" onClick={()=>{setTexts(current?.texts ?? doc.data.transcript.map(m=>m.text));setReason("");setEditing(true);}}>Исправить транскрипт вручную</button>
 {editing && <div><p>Исправляйте только подтверждённый по записи текст. Сохранение не запускает модель и не меняет старые оценки.</p>{doc.data.transcript.map((m,i)=><label key={i}>#{i+1} · {m.speaker} · {m.timestamp}<textarea aria-label={`Исправление реплики ${i+1}`} maxLength={20000} value={texts[i]} onChange={e=>setTexts(texts.map((t,j)=>j===i?e.target.value:t))}/><small>Оригинал: {m.text}</small></label>)}<label>Причина исправления<textarea aria-label="Причина исправления" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy || !reason.trim() || texts.some(t=>!t.trim())} onClick={async()=>{await save({op:"correctTranscript",doc:doc.id,texts,reason});}}>Сохранить отдельную версию</button><button onClick={()=>setEditing(false)}>Закрыть редактор</button></div>}
 </section>;
}

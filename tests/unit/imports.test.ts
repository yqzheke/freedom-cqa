import { expect, it } from "vitest";
import { rememberImport } from "../../lib/imports";
import { batchDocuments } from "../../lib/control";
import { buildSubmission } from "../../lib/submission";
import { seed, hash } from "../../lib/store";
it("reimporting A after B makes A current without duplicating content or altering assessments",()=>{
  const s=seed();
  const payload=(prefix:string)=>({isSuccess:true,error:"",data:{dataset_group_id:"prod-fixture",total_records:10,records:Array.from({length:10},(_,i)=>({conversation_id:`${prefix}-${i}`,channel:"agent chat" as const,language:"RU" as const,transcript:[{timestamp:"00:00",speaker:"operator" as const,text:`Synthetic ${prefix}`}]}))}});
  const a=payload("A"),b=payload("B");
  for(const p of [a,b]){for(const data of p.data.records)s.docs.push({id:hash(data),group:p.data.dataset_group_id,data});rememberImport(s,p.data.dataset_group_id,p);}
  const preserved=JSON.stringify({docs:s.docs,runs:s.runs,calls:s.calls,versions:s.versions});
  expect(batchDocuments(s,"prod-fixture","prod")[0].data.conversation_id).toBe("B-0");
  rememberImport(s,a.data.dataset_group_id,a);
  expect(s.imports).toHaveLength(2);
  expect(batchDocuments(s,"prod-fixture","prod")[0].data.conversation_id).toBe("A-0");
  expect(buildSubmission(s,{group:"prod-fixture",dataset:"prod",version:"official-chat-v1",provider:"groq",teamName:"Test",source:"original"}).results.map(r=>r.conversation_id)).toEqual(a.data.records.map(d=>d.conversation_id));
  expect(JSON.stringify({docs:s.docs,runs:s.runs,calls:s.calls,versions:s.versions})).toBe(preserved);
  rememberImport(s,a.data.dataset_group_id,a);expect(s.imports).toHaveLength(2);
});

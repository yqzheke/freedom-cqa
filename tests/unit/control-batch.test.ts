import { expect, it } from "vitest";
import { batchDocuments, groupDocuments, groupProgress } from "../../lib/control";
import type { State, Run } from "../../lib/store";
function data():State {
 const docs=Array.from({length:65},(_,i)=>({id:`d${i}`,group:"dev",data:{conversation_id:`c${i}`,channel:(i<60?"agent chat":"voice call") as "agent chat"|"voice call",language:"RU" as const,transcript:[{timestamp:i<60?"00:00":"2026-11-07T00:00:00Z",speaker:"operator" as const,text:"Synthetic batch fixture"}]}}));
 return {docs,versions:[],runs:[],calls:[],appeals:[],imports:[{group:"dev",hash:"h",raw:{isSuccess:true,error:"",data:{dataset_group_id:"dev",total_records:65,records:docs.map(d=>d.data)}}}]};
}
it("DEV batch selects every exact imported document including all five calls",()=>{const s=data();expect(batchDocuments(s,"dev","dev")).toHaveLength(65);expect(groupDocuments(s.docs,"dev",true)).toHaveLength(65);expect(groupDocuments(s.docs,"dev")).toHaveLength(60);});
it("rejects wrong group sizes and missing or stale imported contents",()=>{const s=data();expect(()=>batchDocuments(s,"dev","prod")).toThrow();expect(()=>batchDocuments(s,"dev","control")).toThrow();s.docs=s.docs.slice(1);expect(()=>batchDocuments(s,"dev","dev")).toThrow();});
it("voice progress uses Gemini even when chat provider is Groq and keeps reviews separate",()=>{const s=data(); const doc=s.docs[64];const base={doc:doc.id,version:"v",textProvider:"gemini",id:"voice"} as Run;expect(groupProgress([doc],[base],"v","groq")[0].run?.id).toBe("voice");expect(groupProgress([doc],[{...base,textProvider:"groq"}],"v","groq")[0].run).toBeUndefined();expect(groupProgress([doc],[base],"v2","groq")[0].run).toBeUndefined();});

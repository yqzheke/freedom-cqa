import { describe, expect, it } from "vitest";
import { buildSubmission } from "../../lib/submission";
import { official } from "../../lib/official";
import type { State, Run } from "../../lib/store";
import type { Finding } from "../../lib/domain";
const opts = {group:"test", dataset:"prod", version:"official", provider:"groq", teamName:"Team",source:"original"};
function fixture(dev=false): State {
  const docs=Array.from({length:dev?65:10},(_,i)=>({id:`doc${i}`,group:"test",data:{conversation_id:`source-${i}`,channel:(dev&&i>=60?"voice call":"agent chat") as "voice call"|"agent chat",language:"RU" as const,audio_url:null,transcript:[{timestamp:dev&&i>=60?"2026-11-07T00:00:00Z":"00:00",speaker:"operator" as const,text:"Hello, I am Alex. PRIVATE TRANSCRIPT"}]}}));
  const findings: Finding[]=official.criteria.map(c=>({id:c.id,status:"applicable",answer:c.id==="consult"?20:c.id==="flow"?10:c.id!=="severe",reason:"Rule satisfied",critical:false,evidence:[{from:1,to:1,quote:"",expected:"Whole dialogue checked"}]}));
  findings[0].evidence=[{from:1,to:1,quote:"Hello, I am Alex.",expected:""}];
  const run:Run={id:"run",doc:"doc0",version:"official",key:"key",status:"completed",lease:0,token:"",original:findings,current:structuredClone(findings),error:"PRIVATE ERROR",cancel:false,created:"2026-11-07T00:00:00Z",textProvider:"groq"};
  return {docs,versions:[{id:"official",r:structuredClone(official)}],runs:[run],appeals:[],calls:[{id:"call",run:"run",model:"actual-model",status:"completed",reserve:0,cost:0,usage:null,date:"",pricing:""}],imports:[{group:"test",hash:"",raw:{isSuccess:true,error:"",data:{dataset_group_id:"test",total_records:docs.length,records:docs.map(d=>d.data)}}}]};
}
describe("official submission",()=>{
  it("exports exact schema, canonical IDs and one-based evidence, with all error rows",()=>{
    const out=buildSubmission(fixture(),opts);
    expect(Object.keys(out)).toEqual(["schema_version","team_name","model","results"]);
    expect(out.schema_version).toBe("1.0"); expect(out.model.name).toBe("actual-model"); expect(out.results).toHaveLength(10);
    expect(out.results[0].criteria.map(c=>c.criterion_id)).toEqual(["contact","discovery","identification","consultation","empathy","dialogue","closure","critical"]);
    expect(out.results[0].score).toEqual({final_score:100,critical_flag:false});
    expect(out.results[0].criteria[0].evidence_turns).toEqual([1]);
    expect(out.results[1]).toEqual({conversation_id:"source-1",status:"error",criteria:[],score:null,error:"Assessment not started"});
    expect(JSON.stringify(out)).not.toContain("PRIVATE");
  });
  it("includes all 65 DEV records including five calls",()=>expect(buildSubmission(fixture(true),{...opts,dataset:"dev"}).results).toHaveLength(65));
  it("rejects wrong counts and wrong channel composition",()=>{
    expect(()=>buildSubmission(fixture(),{...opts,dataset:"dev"})).toThrow();
    const s=fixture(); s.docs[1].data.channel="voice call"; s.docs[1].data.transcript[0].timestamp="2026-11-07T00:00:00Z";
    expect(()=>buildSubmission(s,opts)).toThrow();
  });
  it("rejects duplicates in the source manifest",()=>{const s=fixture();s.docs[1].data.conversation_id=s.docs[0].data.conversation_id;expect(()=>buildSubmission(s,opts)).toThrow();});
  it("preserves null only for allowed N/A and recalculates",()=>{
    const s=fixture(); const f=s.runs[0].original.find(f=>f.id==="needs")!; f.status="na";f.answer=null;
    const out=buildSubmission(s,opts);expect(out.results[0].status).toBe("ok");expect(out.results[0].criteria[1].value).toBe(null);expect(out.results[0].score?.final_score).toBe(100);
    s.runs[0].original[0].status="na";s.runs[0].original[0].answer=null;
    expect(buildSubmission(s,opts).results[0].status).toBe("error");
  });
  it("never substitutes review or incompatible values as N/A",()=>{
    for(const answer of [15,"yes",null]) {const s=fixture(); s.runs[0].original.find(f=>f.id==="flow")!.answer=answer;expect(buildSubmission(s,opts).results[0].status).toBe("error");}
    const s=fixture();s.runs[0].original[0].status="review";s.runs[0].original[0].answer=null;expect(buildSubmission(s,opts).results[0].status).toBe("error");
  });
  it("exports chosen assessment revision and preserves original",()=>{
    const s=fixture(); s.runs[0].current[0].answer=false;
    expect(buildSubmission(s,{...opts,source:"current"}).results[0].score?.final_score).toBe(90);
    expect(buildSubmission(s,opts).results[0].score?.final_score).toBe(100);
  });
  it("rejects incomplete criteria and out-of-range evidence",()=>{
    const s=fixture();s.runs[0].original[0].evidence[0].to=2;expect(buildSubmission(s,opts).results[0].status).toBe("error");
    s.runs[0].original=[];expect(buildSubmission(s,opts).results[0].status).toBe("error");
  });
  it("does not fall back to stale content or a different checklist/provider",()=>{
    for(const kind of ["content","version","provider"]) {const s=fixture(); if(kind==="content")s.docs[0]={...s.docs[0],data:{...s.docs[0].data,transcript:[{timestamp:"00:00",speaker:"operator",text:"changed"}]}};if(kind==="version")s.runs[0].version="old";if(kind==="provider")s.runs[0].textProvider="gemini";expect(buildSubmission(s,opts).results[0].status).toBe("error");}
  });
  it("does not invent model calls when the whole set is unassessed",()=>{const s=fixture();s.runs=[];s.calls=[];expect(buildSubmission(s,opts).model.name).toBe("No model invoked");});
});

it("exports only the selected text model and does not substitute another model run",()=>{
const s=fixture();s.runs[0].textModel="openai/gpt-oss-120b";
expect(buildSubmission(s,opts).results[0].status).toBe("error");
expect(buildSubmission(s,{...opts,model:"openai/gpt-oss-120b"}).results[0].status).toBe("ok");
s.runs.push({...structuredClone(s.runs[0]),id:"later-other-model",textModel:"qwen/qwen3.8-27b",status:"failed",created:"2026-11-07T01:00:00Z"});
expect(buildSubmission(s,{...opts,model:"openai/gpt-oss-120b"}).results[0].status).toBe("ok");
});
it("rejects historical contact findings without first operator quote",()=>{
const s=fixture();s.runs[0].original[0].evidence=[{from:1,to:1,quote:"",expected:"Checked greeting"}];
expect(buildSubmission(s,opts).results[0].status).toBe("error");
});

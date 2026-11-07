import {test,expect} from "@playwright/test";
test("DEV batching refuses imported data atomically in free-only mode",async({request})=>{
 const headers={Origin:"http://127.0.0.1:3376"};
 const records=Array.from({length:65},(_,i)=>({conversation_id:`batch-${i}`,channel:i<60?"agent chat":"voice call",language:"RU",transcript:[{timestamp:i<60?"00:00":"2026-11-07T00:00:00Z",speaker:"operator",text:"Synthetic batch safety fixture"}]}));
 const imported=await request.post("/api/workspace",{headers,data:{op:"import",payload:{isSuccess:true,error:"",data:{dataset_group_id:"batch-e2e",total_records:65,records}}}});expect(imported.ok()).toBeTruthy();
 const before=await (await request.get("/api/workspace")).json();
 const started=await request.post("/api/workspace",{headers,data:{op:"startGroup",group:"batch-e2e",dataset:"dev",version:"official-chat-v1"}});
 expect(started.status()).toBe(400);expect((await started.json()).message).toContain("группа не поставлена");
 const after=await (await request.get("/api/workspace")).json();expect(after.runs.length).toBe(before.runs.length);expect(after.calls.length).toBe(before.calls.length);
});

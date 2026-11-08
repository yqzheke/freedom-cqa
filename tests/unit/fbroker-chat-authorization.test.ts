import { expect, it } from "vitest";
import { authorizedFbrokerChat, freeDialogueAllowed } from "../../lib/dev-chat-authorization";
import manifest from "../../lib/fbroker-chat-authorization.json";
import { seed, hash } from "../../lib/store";
function fixture() {
 const s = seed(); const d = structuredClone(s.docs[0].data); d.conversation_id = "fixture-dev";
 const id = hash(["FBroker", d]); s.docs.push({id, group:"FBroker", data:d});
 const raw = { data: { dataset_group_id:"FBroker", records:[d] } };
 s.imports.push({group:"FBroker", hash:hash(raw), raw});
 const grant = {importHash:hash(raw), documents:{[id]:hash(d)}};
 const check = () => authorizedFbrokerChat(s,d,"groq","openai/gpt-oss-120b",id,undefined,grant);
 return {s,d,id,grant,check};
}
it("pins exactly ten distinct original content hashes", () => {
 expect(Object.keys(manifest.documents)).toHaveLength(10);
 expect(new Set(Object.values(manifest.documents)).size).toBe(10);
 expect(manifest.importHash).toBe("930b8914965f0905a58d356c28e9aae567dafa7bb6a6cc8e90c59a05d4759e9f");
});
it("allows only exact authorized source with matching original", () => {
 const f=fixture(); expect(f.check()).toBe(true);
 expect(authorizedFbrokerChat(f.s,f.d,"groq","openai/gpt-oss-120b",f.id)).toBe(false);
});
it.each(["gemini", "other"])("rejects provider %s", provider => {
 const f=fixture(); expect(authorizedFbrokerChat(f.s,f.d,provider,"openai/gpt-oss-120b",f.id,undefined,f.grant)).toBe(false);
});
it.each(["qwen/qwen3.8-27b", "", undefined])("rejects another or unspecified model %s", model => {
 const f=fixture(); expect(authorizedFbrokerChat(f.s,f.d,"groq",model,f.id,undefined,f.grant)).toBe(false);
});
it("rejects transcript revisions, modified text and audio", () => {
 const f=fixture(); expect(authorizedFbrokerChat(f.s,f.d,"groq","openai/gpt-oss-120b",f.id,"revision",f.grant)).toBe(false);
 f.d.transcript[0].text+="changed"; expect(f.check()).toBe(false);
 const g=fixture(); g.d.channel="voice call"; expect(g.check()).toBe(false);
 const h=fixture(); h.d.audio_url="https://example.com/audio.mp3"; expect(h.check()).toBe(false);
});
it("rejects PROD, altered source and a new current DEV import", () => {
 const f=fixture(); f.s.docs.at(-1)!.group="PROD"; expect(f.check()).toBe(false);
 const g=fixture(); g.s.imports[0].raw={data:{}}; expect(g.check()).toBe(false);
 const h=fixture(); h.s.imports.push({group:"FBroker",hash:"new",raw:{}}); expect(h.check()).toBe(false);
});
it("retains built-in synthetic demo permission", () => {
 const s=seed(); expect(freeDialogueAllowed(s,s.docs[0].data,"groq")).toBe(true);
});

import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { demo, type Dialogue, type Rubric, type Finding } from "./domain";
import { official } from "./official";
export const hash = (o: unknown) =>
  createHash("sha256").update(JSON.stringify(o)).digest("hex");
export type Doc = { id: string; group: string; data: Dialogue };
export type Version = { id: string; r: Rubric };
export type Run = {
  audio?: {
    observations: string;
    duration: number;
    fingerprint: string;
    alignment: string;
  };
  id: string;
  doc: string;
  version: string;
  key: string;
  status: string;
  lease: number;
  token: string;
  original: Finding[];
  current: Finding[];
  error: string;
  cancel: boolean;
  created: string;
};
export type Appeal = {
  id: string;
  run: string;
  criterion: string;
  comment: string;
  reason: string;
  action: string;
  previous?: Finding;
  replacement?: Finding;
  revision: number;
};
export type Call = {
  mode?: "free_only";
  id: string;
  run: string;
  model: string;
  status: string;
  reserve: number;
  cost: number | null;
  usage: unknown;
  date: string;
  pricing: string;
  request?: string;
};
export type State = {
  queuePause?: string;
  docs: Doc[];
  versions: Version[];
  runs: Run[];
  appeals: Appeal[];
  calls: Call[];
  imports: { group: string; hash: string; raw: unknown }[];
};
export function seed(): State {
  const greetings = {
    RU: ["Здравствуйте", "Здравствуйте! Чем могу помочь?"],
    KZ: ["Сәлеметсіз бе", "Сәлеметсіз бе! Қалай көмектесе аламын?"],
    EN: ["Hello", "Hello! How can I help?"],
  };
  return {
    docs: Object.entries(greetings).map(([language, lines]) => ({
      id: "demo-" + language,
      group: "DEMO",
      data: {
        conversation_id: "demo-" + language,
        channel: "agent chat",
        language: language as Dialogue["language"],
        audio_url: null,
        transcript: lines.map((text, i) => ({
          timestamp: "00:0" + i,
          speaker: i ? "operator" : "client",
          text,
        })),
      },
    })),
    versions: [
      { id: "demo-v1", r: demo },
      { id: "official-chat-v1", r: official },
    ],
    runs: [],
    appeals: [],
    calls: [],
    imports: [],
  };
}
function db() {
  return process.env.SUPABASE_URL
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false },
      })
    : null;
}
const dir = process.env.CQA_TEST_STATE_DIR || ".cqa";
const file = dir + "/state.json";
async function read() {
  const client = db();
  if (client) {
    const { data, error } = await client
      .from("cqa_workspace")
      .select("revision,body")
      .eq("id", 1)
      .single();
    if (error) throw Error("Хранилище Supabase недоступно");
    return {
      revision: data.revision as number,
      body: (data.body ?? seed()) as State,
    };
  }
  if (process.env.VERCEL) throw Error("Настройте Supabase");
  try {
    return JSON.parse(await readFile(file, "utf8")) as {
      revision: number;
      body: State;
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { revision: 0, body: seed() };
    throw e;
  }
}
export async function state() {
  return (await read()).body;
}
export async function change<T>(fn: (s: State) => T) {
  const client = db();
  for (let i = 0; i < 30; i++) {
    let locked = false;
    try {
      if (!client) {
        await mkdir(dir, { recursive: true });
        try {
          const handle = await open(dir + "/lock", "wx");
          await handle.close();
          locked = true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }
      }
      const { revision, body } = await read();
      const value = fn(body);
      if (client) {
        const { data, error } = await client
          .from("cqa_workspace")
          .update({ revision: revision + 1, body })
          .eq("id", 1)
          .eq("revision", revision)
          .select("id");
        if (error) throw Error("Ошибка сохранения");
        if (!data?.length) continue;
      } else {
        const tmp = file + randomUUID();
        await writeFile(tmp, JSON.stringify({ revision: revision + 1, body }));
        await rename(tmp, file);
      }
      return value;
    } finally {
      if (locked) await unlink(dir + "/lock");
    }
  }
  throw Error("Конфликт записи. Обновите данные");
}

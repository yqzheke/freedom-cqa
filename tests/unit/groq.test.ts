import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: (...args: Parameters<typeof fs.readFile>) =>
      args[0] === ".env.local"
        ? Promise.resolve("GROQ_API_KEY=fixture-local")
        : fs.readFile(...args),
  };
});
beforeEach(async () => {
  vi.resetModules();
  for (const [k, v] of Object.entries({
    SUPABASE_URL: "",
    VERCEL: "",
    DEMO_ACCESS_TOKEN: "",
    CQA_TEST_STATE_DIR: await mkdtemp(join(tmpdir(), "groq-test-")),
    TEXT_EVALUATION_PROVIDER: "groq",
    GROQ_FREE_REQUESTS_PER_DAY: "3",
    GROQ_API_KEY: "ignore-shell",
    GEMINI_API_KEY: "",
    EVALUATION_BUDGET_USD: "0",
    MAX_CALL_USD: "0",
  }))
    vi.stubEnv(k, v);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Unexpected request");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const { POST } = await import("../../app/api/workspace/route");
  const { NextRequest } = await import("next/server");
  const { state } = await import("../../lib/store");
  const post = (body: object) =>
    POST(
      new NextRequest("http://127.0.0.1/api/workspace", {
        method: "POST",
        headers: { host: "127.0.0.1", origin: "http://127.0.0.1" },
        body: JSON.stringify(body),
      }),
    );
  const s = await state(),
    doc = s.docs[0],
    version = s.versions[0];
  const start = () => post({ op: "start", doc: doc.id, version: version.id });
  await start();
  const id = (await state()).runs[0].id;
  const rows = version.r.criteria.map((c, i) => ({
    id: c.id,
    status: i ? "na" : "applicable",
    answer: i ? null : true,
    reason: "synthetic",
    critical: false,
    evidence: [
      { from: 2, to: 2, quote: doc.data.transcript[1].text, expected: "" },
    ],
  }));
  const reply = (results: unknown) =>
    Response.json({
      id: "test",
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ results }) },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  return {
    state,
    post,
    id,
    start,
    rows,
    reply,
    step: () => post({ op: "step", id }),
  };
}
it("uses only Groq for the pinned chat; validates evidence, repairs the answer and scores N/A", async () => {
  const { step, state, rows, reply, start } = await fixture();
  vi.stubEnv("TEXT_EVALUATION_PROVIDER", "gemini");
  await start();
  expect((await state()).runs.map((r) => r.textProvider)).toEqual([
    "groq",
    "gemini",
  ]);
  const bad = structuredClone(rows);
  bad[0].evidence[0].quote = "fabricated";
  vi.mocked(fetch)
    .mockResolvedValueOnce(reply(bad))
    .mockResolvedValueOnce(reply(rows));
  await step();
  const s = await state();
  expect(s.runs[0].status).toBe("completed");
  expect(s.calls.map((c) => [c.provider, c.stage, c.status])).toEqual([
    ["groq", "text", "invalid_response"],
    ["groq", "repair", "complete"],
  ]);
  const { calculate } = await import("../../lib/domain");
  expect(calculate(s.versions[0].r, s.runs[0].current).score).toBe(100);
  for (const [url, opts] of vi.mocked(fetch).mock.calls) {
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((opts?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fixture-local",
    );
    expect(JSON.parse(String(opts?.body))).toMatchObject({
      model: "qwen/qwen3.8-27b",
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
  }
});
it("pauses on Groq 429 with safe diagnostics and no fallback", async () => {
  const { state, step } = await fixture();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response("private error", { status: 429 }),
  );
  await step();
  await step();
  const s = await state();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(s.queuePause).toContain("Groq");
  expect(s.calls[0]).toMatchObject({
    status: "rate_limited",
    diagnostic: "Ошибка Groq: HTTP 429",
  });
  expect(JSON.stringify(s.calls)).not.toContain("private error");
});
it("blocks imported chats before Groq HTTP and keeps voice calls on Gemini", async () => {
  const { state, post } = await fixture();
  const { change } = await import("../../lib/store");
  await change((s) => {
    for (const [id, channel] of [
      ["import", "agent chat"],
      ["voice", "voice call"],
    ] as const)
      s.docs.push({
        id,
        group: "TEST",
        data: { ...s.docs[0].data, conversation_id: id, channel },
      });
  });
  for (const doc of ["import", "voice"]) {
    await post({ op: "start", doc, version: "demo-v1" });
    const r = (await state()).runs.at(-1)!;
    expect(r.textProvider).toBe(doc === "voice" ? "gemini" : "groq");
    await post({ op: "step", id: r.id });
  }
  expect(fetch).not.toHaveBeenCalled();
  expect((await state()).runs.find((r) => r.doc === "import")?.error).toContain(
    "синтетических",
  );
});

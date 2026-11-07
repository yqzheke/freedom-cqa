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
      response_format: { type: "json_object" },
      reasoning_format: "hidden",
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
it("supplies the official first criterion's status policy and persists specific safe repair diagnostics", async () => {
  const { post, state, reply } = await fixture();
  const s = await state(),
    version = s.versions.find((v) => v.id === "official-chat-v1")!;
  await post({ op: "start", doc: "demo-RU", version: version.id });
  const id = (await state()).runs.at(-1)!.id;
  const rows = version.r.criteria.map((c) => ({
    id: c.id,
    status: "applicable",
    answer: c.mapping.kind === "number" ? c.mapping.max : c.id !== "severe",
    critical: false,
    reason: "private fixture explanation",
    evidence: [
      {
        from: 2,
        to: 2,
        quote: s.docs[0].data.transcript[1].text,
        expected: "",
      },
    ],
  }));
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      reply([
        { ...rows[0], status: "review", answer: "private fixture answer" },
        ...rows.slice(1),
      ]),
    )
    .mockResolvedValueOnce(reply(rows));
  await post({ op: "step", id });
  const after = await state(),
    calls = after.calls.filter((c) => c.run === id);
  expect(calls[0].diagnostic).toContain(
    "Критерий №1: Статус review · ANSWER_MUST_BE_NULL",
  );
  expect(calls[0].diagnostic).not.toContain("NA_FORBIDDEN");
  expect(JSON.stringify(calls)).not.toContain("private fixture");
  expect(after.runs.find((r) => r.id === id)?.status).toBe("completed");
  for (const [, opts] of vi.mocked(fetch).mock.calls) {
    const body = JSON.parse(String(opts?.body));
    const input = JSON.parse(body.messages[1].content);
    expect(input.criteria[0].allowedStatuses).toEqual(["applicable", "review"]);
    expect(input.criteria[1].allowedStatuses).toContain("na");
    expect(body.response_format).toEqual({ type: "json_object" });
  }
});
it("rejects an unrecognized status without echoing provider text", async () => {
  const { step, state, rows, reply } = await fixture();
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      reply([{ ...rows[0], status: "private invalid enum" }, ...rows.slice(1)]),
    )
    .mockResolvedValueOnce(reply(rows));
  await step();
  const diagnostic = (await state()).calls[0].diagnostic;
  expect(diagnostic).toContain("results.0.status");
  expect(diagnostic).not.toContain("private invalid enum");
  expect(diagnostic).not.toContain("NA_FORBIDDEN");
});
it("reports only recognized error fields for a repair HTTP 400 and stops after one repair", async () => {
  const { state, rows, step, reply } = await fixture();
  const bad = structuredClone(rows);
  bad[0].evidence[0].quote = "unverified";
  vi.mocked(fetch)
    .mockResolvedValueOnce(reply(bad))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "json_validate_failed",
            type: "invalid_request_error",
            param: "response_format",
            failed_generation: "private",
            message: "private",
          },
        },
        { status: 400 },
      ),
    );
  await step();
  await step();
  const s = await state();
  expect(s.calls[1]).toMatchObject({ stage: "repair", status: "http_error" });
  expect(s.calls[1].diagnostic).toBe(
    "Ошибка Groq: HTTP 400 · code=json_validate_failed · type=invalid_request_error · param=response_format",
  );
  expect(JSON.stringify(s.calls)).not.toContain("private");
  expect(fetch).toHaveBeenCalledTimes(2);
  const requests = vi
    .mocked(fetch)
    .mock.calls.map(([, o]) => JSON.parse(String(o?.body)));
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.model).toBe("qwen/qwen3.8-27b");
    expect(request.response_format).toStrictEqual({ type: "json_object" });
    expect(request.reasoning_format).toBe("hidden");
    expect(request.messages[0].content).toContain(
      "one JSON object with a results array",
    );
  }
  expect(JSON.parse(requests[0].messages[1].content).repair).toBe("");
  expect(JSON.parse(requests[1].messages[1].content).repair).not.toBe("");
});
it("redacts arbitrary error codes, types and parameter values", async () => {
  const { groqFailure } = await import("../../lib/groq-wire");
  const e = await groqFailure(
    Response.json(
      {
        error: {
          type: "untrusted-type",
          code: "untrusted-code",
          param: "untrusted-param",
        },
      },
      { status: 400 },
    ),
  );
  expect(e.message).toBe(
    "Ошибка Groq: HTTP 400 · code=unknown · type=unknown · param=unknown",
  );
});
it("evaluates ten chats under two versions without duplicating calls, losing evidence or rewriting history", async () => {
  const { post, state } = await fixture();
  const { official } = await import("../../lib/official");
  const { groupChats, groupProgress } = await import("../../lib/control");
  vi.stubEnv("TEXT_EVALUATION_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_BILLING_MODE", "budgeted");
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_TEXT_MODEL", "gemini-test");
  vi.stubEnv(
    "MODEL_PRICES_JSON",
    '{"gemini-test":{"input":0,"output":0,"audio":0,"cached":0}}',
  );
  vi.stubEnv("MAX_CALL_USD", "1");
  vi.stubEnv("EVALUATION_BUDGET_USD", "1");
  const records = Array.from({ length: 10 }, (_, i) => ({
    ...requireDoc(),
    conversation_id: "synthetic-" + i,
  }));
  function requireDoc() {
    return {
      language: "EN",
      channel: "agent chat",
      audio_url: null,
      transcript: [
        {
          speaker: "operator",
          text: "Synthetic fixture greeting.",
          timestamp: "00:01",
        },
      ],
    };
  }
  await post({
    op: "import",
    payload: {
      isSuccess: true,
      error: "",
      data: { dataset_group_id: "TEST-CONTROL", total_records: 10, records },
    },
  });
  const edited = structuredClone(official);
  edited.criteria[0].id = "replacement";
  edited.criteria[0].instruction = "Synthetic replacement criterion";
  const answer = (r: typeof official) =>
    r.criteria.map((c) => ({
      id: c.id,
      status: "applicable",
      critical: false,
      answer:
        c.mapping.kind === "boolean"
          ? c.id !== "severe"
          : c.mapping.kind === "number"
            ? c.mapping.max
            : "a",
      reason: "synthetic",
      evidence: [
        { from: 1, to: 1, quote: "Synthetic fixture greeting.", expected: "" },
      ],
    }));
  async function processVersion(version: string, r: typeof official) {
    const start = { op: "startGroup", group: "TEST-CONTROL", version };
    await Promise.all([post(start), post(start)]);
    const s = await state();
    const items = groupProgress(
      groupChats(s.docs, "TEST-CONTROL"),
      s.runs,
      version,
      "gemini",
    );
    expect(items).toHaveLength(10);
    expect(items.every((i) => i.run?.status === "queued")).toBe(true);
    for (const { run } of items) {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [{ text: JSON.stringify({ results: answer(r) }) }],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      );
      await post({ op: "step", id: run!.id });
    }
    await post(start);
    const after = await state();
    const runs = after.runs.filter(
      (x) => x.version === version && items.some((i) => i.doc.id === x.doc),
    );
    expect(runs).toHaveLength(10);
    expect(
      runs.every((x) => x.status === "completed" && x.original.length === 8),
    ).toBe(true);
    return runs;
  }
  const old = await processVersion("official-chat-v1", official);
  await post({ op: "publish", r: edited });
  const newId = (await state()).versions.at(-1)!.id;
  const fresh = await processVersion(newId, edited);
  expect(fresh[0].original[0].id).toBe("replacement");
  expect(fresh[0].original[0].evidence[0].from).toBe(1);
  expect(
    (await state()).runs.filter((r) => old.some((o) => o.id === r.id)),
  ).toEqual(old);
  expect(fetch).toHaveBeenCalledTimes(20);
});
it("sends exactly one JSON Object request when resuming directly at repair", async () => {
  const { id, step, state, reply, rows } = await fixture();
  const { change } = await import("../../lib/store");
  await change((s) => {
    s.runs.find((r) => r.id === id)!.repairReason =
      "Synthetic validation failure";
  });
  vi.mocked(fetch).mockResolvedValueOnce(reply(rows));
  await step();
  const s = await state();
  expect(s.calls.map((c) => [c.stage, c.status])).toEqual([
    ["repair", "complete"],
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(body.response_format).toStrictEqual({ type: "json_object" });
  expect(body.reasoning_format).toBe("hidden");
  expect(JSON.parse(body.messages[1].content).repair).toBe(
    "Synthetic validation failure",
  );
});

it("requires manual resume after retry-after and never repeats a throttled step on its own", async () => {
  const { state, step, post, rows, reply } = await fixture();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(
      { error: { type: "tokens", message: "private body" } },
      { status: 429, headers: {
        "retry-after": "61", "x-ratelimit-limit-tokens": "8000",
        "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "1m0.5s",
        "x-ratelimit-extra-tokens": "private header",
      } },
    )).mockResolvedValueOnce(reply(rows));
    await step();
    const s = await state();
    expect(s.queueRetryAt).toBe(now + 61000);
    for (const part of ["type=tokens", "8000", "Остаток токенов/мин: 0", "окна через 61 с", "Повтор не ранее чем через 61 с"])
      expect(s.calls[0].diagnostic).toContain(part);
    expect(JSON.stringify([s.queuePause, s.calls])).not.toContain("private");
    await post({ op: "resumeQueue" });
    await step();
    clock.mockReturnValue(now + 61001);
    await step();
    expect(fetch).toHaveBeenCalledTimes(1);
    await post({ op: "resumeQueue" });
    await step();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await state()).runs[0].status).toBe("completed");
  } finally { clock.mockRestore(); }
});
it("omits malformed rate headers without copying their contents", async () => {
  const { groqFailure } = await import("../../lib/groq-wire");
  const e = await groqFailure(new Response(null, { status: 429, headers: {
    "retry-after": "private", "x-ratelimit-limit-tokens": "-1",
    "x-ratelimit-remaining-tokens": "private", "x-ratelimit-reset-tokens": "1s private",
  }}));
  expect(e.message).toBe("Ошибка Groq: HTTP 429");
  expect(e.retryAt).toBeUndefined();
});

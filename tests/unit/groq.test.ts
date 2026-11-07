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
// Existing response-validation tests isolate pacing; groq-pacing.test.ts covers real pacing.
vi.mock("../../lib/groq-pacing", async (original) => ({
  ...(await original<typeof import("../../lib/groq-pacing")>()),
  nextGroqRequestAt: () => 0,
}));
beforeEach(async () => {
  vi.resetModules();
  for (const [k, v] of Object.entries({
    SUPABASE_URL: "",
    VERCEL: "",
    DEMO_ACCESS_TOKEN: "",
    CQA_TEST_STATE_DIR: await mkdtemp(join(tmpdir(), "groq-test-")),
    TEXT_EVALUATION_PROVIDER: "groq",
    GROQ_FREE_REQUESTS_PER_DAY: "3",
    GROQ_TEXT_MODEL: "qwen/qwen3.8-27b",
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
    .mockResolvedValueOnce(reply([rows[0]]));
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
    .mockResolvedValueOnce(reply([rows[0]]));
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
    expect(input.roleAnchors.firstOperatorMessageNumber).toBe(2);
    expect(input.roleAnchors.botMessageNumbers).toEqual([]);
    expect(input.criteria[0].evaluationGuidance.requiredChecks).toHaveLength(4);
    const flow = input.criteria.find((c: { id: string }) => c.id === "flow");
    if (flow)
      expect(flow.evaluationGuidance.requiredChecks.join(" ")).toContain(
        "один эпизод может независимо нарушать",
      );
    const needs = input.criteria.find((c: { id: string }) => c.id === "needs");
    if (needs) {
      expect(needs.evaluationGuidance.requiredChecks).toHaveLength(6);
      expect(needs.evaluationGuidance.requiredChecks.join(" ")).toContain(
        "Never treat facts supplied later as initially known",
      );
    }

    expect(body.messages[0].content).toContain("including false or zero");
    expect(input.outputLanguage).toEqual({
      reason: "ru",
      nonemptyExpected: "ru",
      quote: "verbatim_source_language",
      machineValues: "unchanged",
    });
    const { explanationLanguage } = await import("../../lib/output-language");
    expect(body.messages[0].content.endsWith(explanationLanguage)).toBe(true);
    expect(body.messages[0].content).not.toContain(
      '"reason":"Required action was absent"',
    );
    expect(body.messages[0].content).toContain(
      '"reason":"Обязательное действие отсутствует"',
    );

    expect(
      input.criteria.map((c: { instruction: string }) => c.instruction),
    ).toEqual(
      version.r.criteria
        .filter((c) =>
          input.criteria.some((item: { id: string }) => item.id === c.id),
        )
        .map((c) => c.instruction),
    );
    expect(body.messages[0].content).toContain(
      "Every deduction must name a defect covered by that criterion",
    );
    expect(body.messages[0].content).toContain(
      "a missing introduction alone is not a flow defect",
    );
    expect(body.messages[0].content).toContain(
      "only when it independently violates each definition",
    );
    expect(body.messages[0].content).toContain(
      "distinguish asking an opening question from actually clarifying missing details",
    );

    expect(
      input.transcript.map((m: { messageNumber: number }) => m.messageNumber),
    ).toEqual(input.transcript.map((_: unknown, i: number) => i + 1));
    expect(body.messages[0].content).toContain("never translate, paraphrase");
    expect(body.messages[0].content).toContain(
      "A blank quote never permits blank expected",
    );
    expect(body.messages[0].content).toContain(
      "prohibited acts were checked and not found",
    );
    expect(body.messages[0].content).toContain(
      "choose na with answer=null, not review",
    );
    expect(body.messages[0].content).toContain(
      "conditional on the current criterion definition, not its ID or language",
    );

    if (input.criteria[1])
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
    expect(request.reasoning_effort).toBe("none");
    expect(request.max_completion_tokens).toBe(3000);
    expect(request.messages[0].content).toContain("Escape double quotes");
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
  expect(body.reasoning_effort).toBe("none");
  expect(JSON.parse(body.messages[1].content).repair).toBe(
    "Synthetic validation failure",
  );
});

it("requires manual resume after retry-after and never repeats a throttled step on its own", async () => {
  const { state, step, post, rows, reply } = await fixture();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          { error: { type: "tokens", message: "private body" } },
          {
            status: 429,
            headers: {
              "retry-after": "61",
              "x-ratelimit-limit-tokens": "8000",
              "x-ratelimit-remaining-tokens": "0",
              "x-ratelimit-reset-tokens": "1m0.5s",
              "x-ratelimit-extra-tokens": "private header",
            },
          },
        ),
      )
      .mockResolvedValueOnce(reply(rows));
    await step();
    const s = await state();
    expect(s.queueRetryAt).toBe(now + 61000);
    for (const part of [
      "type=tokens",
      "8000",
      "Остаток токенов/мин: 0",
      "окна через 61 с",
      "Повтор не ранее чем через 61 с",
    ])
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
  } finally {
    clock.mockRestore();
  }
});
it("omits malformed rate headers without copying their contents", async () => {
  const { groqFailure } = await import("../../lib/groq-wire");
  const e = await groqFailure(
    new Response(null, {
      status: 429,
      headers: {
        "retry-after": "private",
        "x-ratelimit-limit-tokens": "-1",
        "x-ratelimit-remaining-tokens": "private",
        "x-ratelimit-reset-tokens": "1s private",
      },
    }),
  );
  expect(e.message).toBe("Ошибка Groq: HTTP 429");
  expect(e.retryAt).toBeUndefined();
});

it("repairs a quoted range for official identification NA with an explicit evidence contract", async () => {
  const { post, state, reply } = await fixture();
  const s = await state();
  const version = s.versions.find((v) => v.id === "official-chat-v1")!;
  const d = s.docs.find((d) => d.id === "demo-RU")!;
  await post({ op: "start", doc: d.id, version: version.id });
  const id = (await state()).runs.at(-1)!.id;
  const good = version.r.criteria.map((c) => ({
    id: c.id,
    status: c.id === "identity" ? "na" : "applicable",
    answer:
      c.id === "identity"
        ? null
        : c.mapping.kind === "number"
          ? c.mapping.max
          : c.id !== "severe",
    critical: false,
    reason: "Synthetic validation fixture, not accuracy measurement",
    evidence:
      c.id === "identity"
        ? [
            {
              from: 1,
              to: 2,
              quote: "",
              expected: "Checked whether identification was required",
            },
          ]
        : [{ from: 2, to: 2, quote: d.data.transcript[1].text, expected: "" }],
  }));
  const bad = structuredClone(good);
  bad[2].status = "na";
  bad[2].answer = null;
  bad[2].evidence = [
    { from: 1, to: 2, quote: d.data.transcript[0].text, expected: "" },
  ];
  // Use the third criterion's actual configured ID, not a provider-generated one.
  good[2] = {
    ...bad[2],
    evidence: [
      {
        from: 1,
        to: 2,
        quote: "",
        expected: "Checked whether identification was required",
      },
    ],
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce(reply(bad))
    .mockResolvedValueOnce(reply([good[2]]));
  await post({ op: "step", id });
  const after = await state();
  const calls = after.calls.filter((c) => c.run === id);
  expect(calls.map((c) => [c.stage, c.status])).toEqual([
    ["text", "invalid_response"],
    ["repair", "complete"],
  ]);
  expect(calls[0].diagnostic).toContain("Критерий №3: EVIDENCE_QUOTE_RANGE");
  expect(calls[0].diagnostic).not.toContain(d.data.transcript[0].text);
  expect(after.runs.find((r) => r.id === id)?.status).toBe("completed");
  expect(after.runs.find((r) => r.id === id)?.current[2].evidence).toEqual(
    good[2].evidence,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  const bodies = vi
    .mocked(fetch)
    .mock.calls.map(([, o]) => JSON.parse(String(o?.body)));
  for (const body of bodies) {
    expect(body.messages[0].content).toContain("from MUST equal to");
    expect(body.messages[0].content).toContain(
      "These rules also apply to NA findings",
    );
    expect(body.messages[0].content).toContain(
      "return separate evidence items",
    );
  }
  expect(JSON.parse(bodies[1].messages[1].content).repair).toContain(
    "EVIDENCE_QUOTE_RANGE",
  );
});

it("persists a targeted repair across quota pause and resumes without regenerating valid findings", async () => {
  const { id, step, post, state, reply, rows } = await fixture();
  vi.stubEnv("GROQ_FREE_REQUESTS_PER_DAY", "1");
  const bad = structuredClone(rows);
  bad[0].evidence = [];
  vi.mocked(fetch).mockResolvedValueOnce(reply(bad));
  await step();
  const initial = await state();
  expect(fetch).toHaveBeenCalledTimes(1);
  const draft = initial.runs[0].repairDraft!;
  expect(draft.targetIds).toEqual([rows[0].id]);
  expect(draft.accepted).toEqual(rows.slice(1));
  expect(initial.runs[0].current).toEqual([]);
  // Re-import the disk-backed store to exercise persisted rather than closure state.
  vi.resetModules();
  const disk = await import("../../lib/store");
  expect((await disk.state()).runs[0].repairDraft).toEqual(draft);
  vi.stubEnv("GROQ_FREE_REQUESTS_PER_DAY", "2");
  await post({ op: "resumeQueue" });
  await post({ op: "retry", id, attempt: 0 });
  vi.mocked(fetch).mockResolvedValueOnce(reply([rows[0]]));
  await step();
  const after = await state();
  expect(after.runs[0].status).toBe("completed");
  expect(after.runs[0].current).toEqual(rows);
  expect(after.calls.map((c) => c.stage)).toEqual(["text", "repair"]);
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  const input = JSON.parse(body.messages[1].content);
  expect(input.criteria.map((c: { id: string }) => c.id)).toEqual([rows[0].id]);
  expect(input.repairCandidates).toEqual([bad[0]]);
  expect(input.repairErrors.join()).toContain("EVIDENCE_REQUIRED");
  expect(input.repairScope).toContain("untrusted suggestions");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects repair that attempts to replace an already validated criterion, with no third automatic call", async () => {
  const { step, state, reply, rows } = await fixture();
  const bad = structuredClone(rows);
  bad[0].evidence = [];
  vi.mocked(fetch)
    .mockResolvedValueOnce(reply(bad))
    .mockResolvedValueOnce(reply(rows));
  await step();
  await step();
  const s = await state();
  expect(s.runs[0].status).toBe("failed");
  expect(s.runs[0].current).toEqual([]);
  expect(s.runs[0].repairDraft?.accepted).toEqual(rows.slice(1));
  expect(s.calls[1].diagnostic).toContain("ASSESSMENT_IDS");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects a persisted repair after its rubric changes before sending another request", async () => {
  const { id, step, state, post, reply, rows } = await fixture();
  vi.stubEnv("GROQ_FREE_REQUESTS_PER_DAY", "1");
  const bad = structuredClone(rows);
  bad[0].evidence = [];
  vi.mocked(fetch).mockResolvedValueOnce(reply(bad));
  await step();
  const { change } = await import("../../lib/store");
  await change((s) => {
    s.versions[0].r.criteria[0].instruction += " changed";
  });
  vi.stubEnv("GROQ_FREE_REQUESTS_PER_DAY", "3");
  await post({ op: "resumeQueue" });
  await post({ op: "retry", id, attempt: 0 });
  await step();
  expect((await state()).runs[0].error).toContain("REPAIR_CONTEXT_CHANGED");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("pins GPT-OSS for main and repair despite subsequent configuration changes", async () => {
  vi.stubEnv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b");
  const { step, state, rows, reply, start } = await fixture();
  expect((await state()).runs[0].textModel).toBe("openai/gpt-oss-120b");
  vi.stubEnv("GROQ_TEXT_MODEL", "qwen/qwen3.8-27b");
  await start();
  expect((await state()).runs).toHaveLength(2);
  const bad = structuredClone(rows);
  bad[0].evidence[0].quote = "fabricated";
  vi.mocked(fetch)
    .mockResolvedValueOnce(reply(bad))
    .mockResolvedValueOnce(reply([rows[0]]));
  await step();
  const s = await state();
  expect(s.runs[0].status).toBe("completed");
  expect(s.calls).toHaveLength(2);
  expect(
    s.calls.every(
      (c) => c.model === "openai/gpt-oss-120b" && c.mode === "free_only",
    ),
  ).toBe(true);
  for (const [, opts] of vi.mocked(fetch).mock.calls) {
    const body = JSON.parse(String(opts?.body));
    expect(body).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      include_reasoning: false,
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("reasoning_format");
  }
});
it("rejects unknown models and retains zero budgets and shared quota", async () => {
  const { configuredGroqModel, groqReasoning } =
    await import("../../lib/groq-models");
  const { freePolicy, quotaReached } = await import("../../lib/free-tier");
  vi.stubEnv("GROQ_TEXT_MODEL", "unapproved-model");
  expect(() => configuredGroqModel()).toThrow();
  expect(() => groqReasoning("unapproved-model")).toThrow();
  expect(() => freePolicy("unapproved-model", "groq")).toThrow();
  expect(freePolicy("openai/gpt-oss-120b", "groq")).toEqual({ cap: 3 });
  vi.stubEnv("MAX_CALL_USD", "1");
  expect(() => freePolicy("openai/gpt-oss-120b", "groq")).toThrow();
  vi.stubEnv("MAX_CALL_USD", "0");
  vi.stubEnv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b");
  const { state, step, reply, rows } = await fixture();
  vi.mocked(fetch).mockResolvedValueOnce(reply(rows));
  await step();
  expect(quotaReached(await state(), 1, new Date().toISOString(), "groq")).toBe(
    true,
  );
});

it("keeps imported chats blocked for GPT-OSS", async () => {
  vi.stubEnv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b");
  const { state, post } = await fixture();
  const { change } = await import("../../lib/store");
  await change((s) => {
    s.docs.push({
      ...s.docs[0],
      id: "private-doc",
      data: { ...s.docs[0].data, conversation_id: "private-doc" },
    });
  });
  await post({
    op: "start",
    doc: "private-doc",
    version: (await state()).versions[0].id,
  });
  const run = (await state()).runs.find((r) => r.doc === "private-doc")!;
  await post({ op: "step", id: run.id });
  expect(fetch).not.toHaveBeenCalled();
  expect((await state()).calls).toHaveLength(0);
});

it("group deduplication distinguishes explicit models and preserves legacy Qwen runs", async () => {
  const { state } = await fixture();
  const { groupProgress } = await import("../../lib/control");
  const s = await state(),
    run = s.runs[0],
    doc = s.docs.find((d) => d.id === run.doc)!;
  const legacy = { ...run };
  delete legacy.textModel;
  expect(
    groupProgress([doc], [legacy], run.version, "groq", "qwen/qwen3.8-27b")[0]
      .run?.id,
  ).toBe(run.id);
  expect(
    groupProgress(
      [doc],
      [legacy],
      run.version,
      "groq",
      "openai/gpt-oss-120b",
    )[0].run,
  ).toBeUndefined();
  const oss = { ...run, id: "oss", textModel: "openai/gpt-oss-120b" };
  expect(
    groupProgress(
      [doc],
      [legacy, oss],
      run.version,
      "groq",
      "openai/gpt-oss-120b",
    )[0].run?.id,
  ).toBe("oss");
});

it("repairs a failed literal quote only through a new explicit message selection", async () => {
  const { step, state, reply, rows } = await fixture();
  const bad = structuredClone(rows);
  bad[0].evidence[0].quote = "fabricated quote";
  vi.mocked(fetch)
    .mockResolvedValueOnce(reply(bad))
    .mockResolvedValueOnce(
      reply([
        { ...rows[0], evidence: [{ kind: "message", messageNumber: 2 }] },
      ]),
    );
  await step();
  const after = await state();
  expect(after.calls.map((c) => c.status)).toEqual([
    "invalid_response",
    "complete",
  ]);
  expect(after.runs[0].status).toBe("completed");
  expect(after.runs[0].current[0].evidence[0]).toEqual({
    ...rows[0].evidence[0],
    quoteSource: "message_reference",
  });
  expect(after.runs[0].current.slice(1)).toEqual(rows.slice(1));
  expect(after.runs[0].repairDraft?.candidates[0].evidence[0].quote).toBe(
    "fabricated quote",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("derives critical from the configured boolean answer without spending a repair call", async () => {
  const { step, state, reply, rows } = await fixture();
  const { change } = await import("../../lib/store");
  await change((s) => {
    const c = s.versions[0].r.criteria[0];
    c.critical = "Flag follows boolean answer";
    c.flagFromAnswer = true;
  });
  const values = structuredClone(rows);
  values[0].answer = true;
  values[0].critical = false;
  vi.mocked(fetch).mockResolvedValueOnce(reply(values));
  await step();
  const s = await state();
  expect(s.runs[0].status).toBe("completed");
  expect(s.runs[0].current[0]).toEqual({ ...values[0], critical: true });
  expect(s.calls).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
beforeEach(async () => {
  vi.resetModules();
  for (const [k, v] of Object.entries({
    CQA_TEST_STATE_DIR: await mkdtemp(join(tmpdir(), "cqa-free-")),
    SUPABASE_URL: "",
    GEMINI_API_KEY: "test-only",
    GEMINI_FREE_MODEL: "gemini-3.5-flash",
    GEMINI_BILLING_MODE: "free_only",
    MAX_CALL_USD: "0",
    EVALUATION_BUDGET_USD: "0",
    GEMINI_FREE_REQUESTS_PER_DAY: "1",
  }))
    vi.stubEnv(k, v);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        responseId: "fixture",
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function harness() {
  const { billed } = await import("../../lib/provider");
  const { generate, usage, defaultModel } = await import("../../lib/gemini");
  return (model = defaultModel) =>
    billed(
      "fixture",
      model,
      () => generate(model, "test", [{ text: "synthetic" }], 10),
      usage,
    );
}
it("atomically allows one request at zero cost under simultaneous attempts", async () => {
  const run = await harness();
  const results = await Promise.allSettled([run(), run()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  const s = await (await import("../../lib/store")).state();
  expect(s.queuePause).toContain("лимит");
  expect(s.calls[0].cost).toBe(0);
});
it("persists a 429 pause across module reload and never issues a fallback call", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429 }));
  await expect((await harness())()).rejects.toThrow();
  vi.resetModules();
  await expect((await harness())()).rejects.toThrow(/429/);
  const s = await (await import("../../lib/store")).state();
  expect(s.calls[0].status).toBe("rate_limited");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects a different model, nonzero dollars, unknown mode and zero budget in ordinary mode before HTTP", async () => {
  const run = await harness();
  await expect(run("gemini-other")).rejects.toThrow();
  vi.stubEnv("MAX_CALL_USD", "1");
  await expect(run()).rejects.toThrow();
  vi.stubEnv("MAX_CALL_USD", "0");
  for (const mode of ["typo", "budgeted"]) {
    vi.stubEnv("GEMINI_BILLING_MODE", mode);
    await expect(run()).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});
async function jobFixture() {
  vi.stubEnv("GEMINI_FREE_REQUESTS_PER_DAY", "8");
  const { change, state } = await import("../../lib/store");
  const s = await state(),
    d = s.docs[0].data,
    r = s.versions[0].r;
  await change((s) => {
    s.runs.push({
      id: "job",
      doc: "doc",
      version: "v",
      key: "k",
      status: "running",
      lease: Date.now() + 60000,
      token: "first",
      original: [],
      current: [],
      cancel: false,
      error: "",
      created: new Date().toISOString(),
    });
  });
  const { evaluate } = await import("../../lib/provider");
  return {
    state,
    change,
    run: (token = "first") => evaluate("job", d, r, token),
  };
}
it("records validation and repair HTTP failure separately without response bodies, resumes only repair", async () => {
  const { run, state, change } = await jobFixture();
  const privateText = "PRIVATE-FAULT-CONTENT";
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({ results: [{ status: privateText }] }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
      }),
    )
    .mockResolvedValueOnce(new Response(privateText, { status: 503 }));
  await expect(run()).rejects.toThrow(/503/);
  const s = await state();
  expect(s.calls.map((c) => [c.stage, c.status])).toEqual([
    ["text", "invalid_response"],
    ["repair", "http_error"],
  ]);
  expect(s.calls[0].diagnostic).toContain("ASSESSMENT_IDS");
  expect(s.calls[0].usage).toBeTruthy();
  expect(JSON.stringify(s.calls)).not.toContain(privateText);
  await change((s) => {
    s.runs[0].token = "second";
    s.runs[0].attempt = 1;
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(privateText, { status: 403 }),
  );
  await expect(run("second")).rejects.toThrow(/403/);
  expect((await state()).calls.at(-1)).toMatchObject({
    stage: "repair",
    attempt: 1,
    status: "http_error",
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("blocks a stale lease and concurrent duplicate execution before a second provider call", async () => {
  const { run } = await jobFixture();
  await expect(run("stale")).rejects.toThrow();
  vi.mocked(fetch).mockImplementation(
    async () => new Response(null, { status: 502 }),
  );
  await Promise.allSettled([run(), run()]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects a delayed retry even if the next attempt has already failed", async () => {
  const { change, state } = await jobFixture();
  const { retryRun } = await import("../../lib/diagnostics");
  await change((s) => {
    const r = s.runs[0];
    r.status = "failed";
    retryRun(r, 0);
    r.status = "failed";
  });
  await expect(change((s) => retryRun(s.runs[0], 0))).rejects.toThrow(
    /Конфликт/,
  );
  expect((await state()).runs[0]).toMatchObject({
    attempt: 1,
    status: "failed",
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects imported conversations in free mode before any provider call", async () => {
  const { state } = await jobFixture();
  const { evaluate } = await import("../../lib/provider");
  const s = await state();
  await expect(
    evaluate(
      "job",
      {
        ...s.docs[0].data,
        transcript: [
          {
            speaker: "operator",
            timestamp: "00:00",
            text: "synthetic external fixture",
          },
        ],
      },
      s.versions[0].r,
      "first",
    ),
  ).rejects.toThrow(/синтетических/);
  expect(fetch).not.toHaveBeenCalled();
});
it("sends reviewer context only in the authorized reassessment and retains the human outcome on HTTP failure", async () => {
  const { change, state } = await jobFixture();
  const { recordDecision } = await import("../../lib/review");
  const { POST } = await import("../../app/api/workspace/route");
  const { NextRequest } = await import("next/server");
  vi.stubEnv("DEMO_ACCESS_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  const id = await change((s) => {
    const parent = s.runs[0],
      rubric = s.versions[0],
      doc = s.docs[0];
    parent.doc = doc.id;
    parent.version = rubric.id;
    parent.status = "completed";
    parent.original = rubric.r.criteria.map((c) => ({
      id: c.id,
      status: "applicable",
      answer: true,
      critical: false,
      reason: "synthetic",
      evidence: [
        { from: 2, to: 2, quote: doc.data.transcript[1].text, expected: "" },
      ],
    }));
    parent.current = structuredClone(parent.original);
    parent.current[0].answer = false;
    const a = {
      id: "appeal",
      run: parent.id,
      criterion: parent.current[0].id,
      comment: "synthetic",
      action: "replace",
      reason: "fixture human reason",
      revision: 0,
    };
    s.appeals.push(a);
    recordDecision(s, a);
    return s.runs[1].id;
  });
  const post = (body: object) =>
    POST(
      new NextRequest("http://127.0.0.1/api/workspace", {
        method: "POST",
        headers: { host: "127.0.0.1", origin: "http://127.0.0.1" },
        body: JSON.stringify(body),
      }),
    );
  expect((await post({ op: "step", id })).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response("ignored", { status: 503 }),
  );
  await post({ op: "requestReview", id: "appeal" });
  await post({ op: "step", id });
  const s = await state();
  expect(s.runs[1].status).toBe("failed");
  expect(s.runs[1].review?.errors?.[0].message).toContain("503");
  expect(s.runs[0].current[0].answer).toBe(false);
  expect(s.runs[0].original[0].answer).toBe(true);
  expect(s.appeals[0].reason).toBe("fixture human reason");
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  const context = JSON.parse(body.contents[0].parts[0].text);
  expect(context.review.humanDecisions[0]).toMatchObject({
    answer: false,
    reason: "fixture human reason",
  });
});

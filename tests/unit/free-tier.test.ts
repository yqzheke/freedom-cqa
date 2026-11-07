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

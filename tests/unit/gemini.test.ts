import { it, expect, vi, afterEach } from "vitest";
import { generate, generatedJSON, usage, defaultModel } from "../../lib/gemini";
afterEach(() => vi.unstubAllGlobals());
it("sends audio to Gemini, excludes thought text and accounts for thinking tokens", async () => {
  const result = {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [{ text: "hidden", thought: true }, { text: '{"ok":true}' }],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 20,
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }],
      thoughtsTokenCount: 3,
      candidatesTokenCount: 8,
    },
  };
  const fake = vi.fn().mockResolvedValue(Response.json(result));
  vi.stubGlobal("fetch", fake);
  const r = await generate(
    defaultModel,
    "listen",
    [{ inlineData: { mimeType: "audio/mpeg", data: "test-fixture" } }],
    100,
  );
  expect(fake.mock.calls[0][0]).toMatch(
    /^https:\/\/generativelanguage\.googleapis\.com\//,
  );
  expect(
    JSON.parse(fake.mock.calls[0][1].body).contents[0].parts[0].inlineData
      .mimeType,
  ).toBe("audio/mpeg");
  expect(generatedJSON(r)).toEqual({ ok: true });
  expect(usage(r)).toMatchObject({ audio: 10, output: 11 });
  expect(() =>
    generatedJSON({ candidates: [{ finishReason: "SAFETY" }] }),
  ).toThrow();
});

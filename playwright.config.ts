import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = (process.env.CQA_E2E_DIR ??= mkdtempSync(
  join(tmpdir(), "cqa-e2e-"),
));
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3376",
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    env: {
      CQA_TEST_STATE_DIR: dir,
      GEMINI_API_KEY: "",
      GEMINI_BILLING_MODE: "free_only",
      TEXT_EVALUATION_PROVIDER: "gemini",
      SUPABASE_URL: "",
      DEMO_ACCESS_TOKEN: "",
    },
    command: "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3376",
    url: "http://127.0.0.1:3376",
    reuseExistingServer: false,
  },
});

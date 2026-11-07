import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seed } from "../../lib/store";
test("review a synthetic stored machine finding and preserve original on reload", async ({
  page,
}) => {
  const path = join(process.env.CQA_E2E_DIR!, "state.json");
  let body = seed();
  try {
    body = JSON.parse(await readFile(path, "utf8")).body;
  } catch {}
  const original = body.versions[0].r.criteria.map((c) => ({
    id: c.id,
    status: "applicable" as const,
    answer: true,
    reason: "Синтетический тест",
    evidence: [
      {
        from: 2,
        to: 2,
        quote: body.docs[0].data.transcript[1].text,
        expected: "",
      },
    ],
    critical: false,
  }));
  body.runs.push({
    id: "fixture-review",
    doc: "demo-RU",
    version: "demo-v1",
    key: "review-fixture",
    status: "completed",
    lease: 0,
    token: "",
    original,
    current: structuredClone(original),
    error: "",
    cancel: false,
    created: new Date().toISOString(),
  });
  await writeFile(path, JSON.stringify({ revision: 1, body }));
  await page.goto("/");
  await page.getByLabel("Версия чек-листа").selectOption("demo-v1");
  await page.locator("button.evidence").first().click();
  await expect(page.locator("#m2")).toHaveClass("highlight");
  await page.getByText("Оспорить", { exact: true }).first().click();
  await page.getByLabel("Комментарий").first().fill("Проверить ответ");
  await page.getByRole("button", { name: "Подать апелляцию" }).first().click();
  await page.getByRole("button", { name: "Апелляции", exact: true }).click();
  await page.getByLabel("Причина решения").fill("Тестовая замена");
  await page
    .getByRole("combobox", { name: "Ответ", exact: true })
    .selectOption("false");
  await page.getByRole("button", { name: "Изменить оценку" }).click();
  await expect(page.getByText("replace · Тестовая замена")).toBeVisible();
  await expect(
    page.getByText(/Зафиксированный ответ проверяющего: false/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Разрешить повторную оценку Gemini" })
    .click();
  await expect(
    page.getByText(/Повторная оценка: failed.*GEMINI_API_KEY/),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("Версия чек-листа").selectOption("demo-v1");
  await expect(
    page.getByText("Исходная оценка: 100 · Итоговая: 40"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Рекомендации оператору" }),
  ).toBeVisible();
});
test("displays all eight official criterion answers and opens their supporting messages", async ({
  page,
}) => {
  const path = join(process.env.CQA_E2E_DIR!, "state.json");
  const state = JSON.parse(await readFile(path, "utf8"));
  const s = state.body as ReturnType<typeof seed>;
  const d = s.docs.find((d) => d.id === "demo-EN")!,
    v = s.versions.find((v) => v.id === "official-chat-v1")!;
  const rows = v.r.criteria.map((c) => ({
    id: c.id,
    answer: c.mapping.kind === "number" ? c.mapping.max : c.id !== "severe",
    status: "applicable" as const,
    critical: false,
    reason: "Test evidence",
    evidence: [
      { from: 2, to: 2, quote: d.data.transcript[1].text, expected: "" },
    ],
  }));
  s.runs.push({
    id: "official-view",
    key: "official-view",
    status: "completed",
    doc: d.id,
    version: v.id,
    current: rows,
    original: rows,
    created: "",
    lease: 0,
    token: "",
    error: "",
    cancel: false,
  });
  await writeFile(path, JSON.stringify(state));
  await page.goto("/");
  await page.getByLabel("Версия чек-листа").selectOption(v.id);
  await page.getByRole("button", { name: /demo-EN/ }).click();
  for (const [i, c] of v.r.criteria.entries()) {
    const panel = page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: c.title, exact: true }),
      });
    await expect(panel.locator("b")).toContainText(typeof rows[i].answer === "boolean" ? rows[i].answer ? "Да" : "Нет" : String(rows[i].answer));
    await panel.getByRole("button", { name: /#2/ }).click();
    await expect(page.locator("#m2")).toHaveClass("highlight");
  }
});

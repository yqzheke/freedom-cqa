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
  await page.reload();
  await page.getByLabel("Версия чек-листа").selectOption("demo-v1");
  await expect(
    page.getByText("Исходная оценка: 100 · Итоговая: 40"),
  ).toBeVisible();
});

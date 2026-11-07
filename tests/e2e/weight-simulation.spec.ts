import { test, expect } from "@playwright/test";
import { seed } from "../../lib/store";
test("weight scenario is reversible and never posts or changes saved findings", async ({
  page,
}) => {
  const s = seed(),
    v = s.versions[0];
  const current = v.r.criteria.map((c, i) => ({
    id: c.id,
    status: "applicable" as const,
    answer: i === 0,
    reason: "fixture",
    critical: false,
    evidence: [
      {
        from: 2,
        to: 2,
        quote: s.docs[0].data.transcript[1].text,
        expected: "",
      },
    ],
  }));
  s.runs.push({
    id: "sim",
    doc: "demo-RU",
    version: v.id,
    key: "fixture",
    status: "completed",
    lease: 0,
    token: "",
    original: structuredClone(current),
    current,
    error: "",
    cancel: false,
    created: "2026-11-07",
  });
  let posts = 0;
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "POST") posts++;
    await route.fulfill({ json: s });
  });
  await page.goto("/");
  await page.getByLabel("Версия чек-листа").selectOption(v.id);
  await page.getByRole("button", { name: "Симуляция", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Что изменится, если…" }),
  ).toBeVisible();
  await page.getByLabel("Вес: Приветствие", { exact: true }).fill("20");
  await page.getByLabel("Вес: Следующий шаг", { exact: true }).fill("80");
  await page.screenshot({
    path: "test-results/simulator-desktop.png",
    fullPage: true,
  });
  const row = page.getByRole("row").filter({ hasText: "demo-RU" });
  await expect(row).toContainText("-40");
  await page.getByRole("button", { name: "Сбросить сценарий" }).click();
  await expect(row.getByRole("cell").nth(2)).toHaveText("60");
  await page.getByLabel("Вес: Приветствие", { exact: true }).fill("");
  await expect(
    page.getByRole("region", { name: "Симулятор весов" }).getByRole("alert"),
  ).toBeVisible();
  await page.getByLabel("Версия чек-листа").selectOption("official-chat-v1");
  await expect(
    page.getByRole("region", { name: "Симулятор весов" }).getByRole("alert"),
  ).toHaveCount(0);
  expect(posts).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/simulator-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

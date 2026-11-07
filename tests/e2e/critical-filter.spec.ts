import { test, expect } from "@playwright/test";
import { seed, type Run } from "../../lib/store";
test("critical filter respects current rubric, provider, original transcript and appealed findings", async ({page}) => {
  const s = seed();
  const v = s.versions.find(v => v.id === "official-chat-v1")!;
  const rows = (critical: boolean) => v.r.criteria.map(c => ({
    id: c.id, status: "applicable" as const,
    answer: c.id === "severe" ? critical : c.mapping.kind === "number" ? c.mapping.max : true,
    critical: c.id === "severe" && critical, reason: "Synthetic fixture",
    evidence: [{from: 2, to: 2, quote: s.docs[0].data.transcript[1].text, expected: ""}],
  }));
  const run = (doc: string, overrides: Partial<Run> = {}): Run => ({
    id: doc, doc, version: v.id, key: doc, status: "completed", lease: 0, token: "",
    current: rows(true), original: rows(true), error: "", cancel: false, created: "2026-11-07", ...overrides,
  });
  s.runs.push(run("demo-RU"), run("demo-EN", {current: rows(false)}),
    run("demo-KZ", {textProvider: "groq", textModel: "openai/gpt-oss-120b"}),
    run("demo-EN", {id: "corrected", transcriptRevision: "corrected"}));
  let posts = 0;
  await page.route("**/api/workspace", route => {
    if(route.request().method() === "POST") posts++;
    return route.fulfill({json: {...s, textProvider: "gemini"}});
  });
  await page.goto("/");
  await page.getByLabel("Версия чек-листа").selectOption(v.id);
  const list = page.getByRole("complementary", {name: "Список диалогов"});
  const checkbox = page.getByLabel("Только с грубой ошибкой");
  await checkbox.check();
  await expect(list.locator("button.item")).toHaveCount(1);
  await expect(list.locator("button.item")).toContainText("demo-RU");
  await list.locator("button.item").click();
  await expect(page.getByText("Обнаружена грубая ошибка", {exact: true})).toBeVisible();
  await page.getByLabel("Язык", {exact: true}).selectOption("EN");
  await expect(list.getByRole("status")).toHaveText("Нет диалогов по выбранным фильтрам.");
  await page.getByLabel("Язык", {exact: true}).selectOption("");
  await page.getByLabel("Версия чек-листа").selectOption("demo-v1");
  await expect(list.locator("button.item")).toHaveCount(0);
  await checkbox.uncheck();
  await expect(list.locator("button.item")).toHaveCount(s.docs.length);
  expect(posts).toBe(0);
});
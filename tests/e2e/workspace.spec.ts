import { test, expect } from "@playwright/test";
test("publish unseen criterion, select dialogue and track real execution failure without credentials", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "demo-RU" })).toBeVisible();
  await page.getByRole("button", { name: "Чек-листы", exact: true }).click();
  await page.getByRole("button", { name: "Добавить критерий" }).click();
  await page
    .getByLabel("Название критерия", { exact: true })
    .last()
    .fill("Новый тестовый критерий");
  await page.getByLabel("Название версии").fill("E2E custom");
  await page.getByRole("button", { name: "Опубликовать версию" }).click();
  await expect(
    page.getByLabel("Версия чек-листа").locator("option:checked"),
  ).toContainText("E2E custom");
  await page.getByRole("button", { name: "Диалоги", exact: true }).click();
  await page.getByRole("button", { name: "Запустить оценку" }).click();
  await expect(page.getByText(/ошибкой.*GEMINI_API_KEY/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/ошибкой.*GEMINI_API_KEY/)).toBeVisible();
  const retry = page.getByRole("button", { name: "Повторить оценку" });
  const request = page.waitForRequest(
    (req) => req.method() === "POST" && req.postDataJSON()?.op === "retry",
  );
  await retry.click();
  await request;
  await expect(page.getByText(/ошибкой.*GEMINI_API_KEY/)).toBeVisible();
});

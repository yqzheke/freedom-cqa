import { test, expect } from "@playwright/test";
import { seed } from "../../lib/store";
test("redesigned workspace keeps evidence navigation and mobile layout accessible", async ({ page }) => {
  const state = seed();
  const v = state.versions[1];
  const findings = v.r.criteria.map((c, i) => ({
    id: c.id, status: "applicable" as const,
    answer: c.mapping.kind === "number" ? c.mapping.max : i === 7 ? false : true,
    reason: "Синтетический пример для проверки интерфейса.",
    critical: false,
    evidence: [{ from: 2, to: 2, quote: state.docs[0].data.transcript[1].text, expected: "" }],
  }));
  state.runs.push({ id:"ui-fixture", doc:"demo-RU", version:v.id, key:"ui-fixture", status:"completed", lease:0, token:"", original:findings, current:findings, error:"", cancel:false, created:"2026-11-07T12:00:00Z" });
  await page.route("**/api/workspace", route => route.fulfill({ json: { ...state, textProvider:"gemini" } }));
  await page.setViewportSize({ width:1440, height:1000 });
  await page.goto("/");
  await expect(page.locator(".criterion-card")).toHaveCount(8);
  await expect(page.locator(".score")).toContainText("100.00");
  await page.locator("button.evidence").first().click();
  await expect(page.locator("#m2")).toHaveClass("highlight");
  await page.getByText("Оспорить", { exact:true }).first().click();
  await expect(page.getByLabel("Комментарий").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path:"test-results/redesign-desktop.png", fullPage:true });
  await page.getByRole("button",{name:"Чек-листы",exact:true}).click();
  await expect(page.getByRole("button",{name:"Добавить критерий"})).toBeVisible();
  await page.getByRole("button",{name:"Диалоги",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("navigation",{name:"Основная навигация"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/redesign-mobile.png",fullPage:false});
});
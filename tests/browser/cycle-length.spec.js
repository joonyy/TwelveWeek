import { test, expect } from "@playwright/test";

test("eleven-week setup, execution navigation and reflection follow the chosen period", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("11주 기간 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByLabel("이번 12주의 이름").fill("나의 11주 실행");
  await page.getByLabel("시작 월요일").fill("2026-10-12");
  await page.getByLabel("실행 주수").selectOption("11");
  await expect(page.getByLabel("이번 11주의 이름")).toHaveValue(
    "나의 11주 실행",
  );
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await expect(page.getByLabel("실행 주수")).toHaveValue("11");
  await expect(page.locator(".cycle-meta")).toContainText("10.12 — 12.27");
  await expect(page.locator(".cycle-meta")).toContainText("12주차 12.28 — 1.3");
  await page
    .getByRole("textbox", { name: "장기 비전 1", exact: true })
    .fill("실행을 누적하는 삶");
  await page.getByRole("tab", { name: "목표와 11주 계획" }).click();
  await expect(
    page.locator(".week-chips").first().getByRole("button"),
  ).toHaveCount(11);
  await page
    .getByLabel("03. 11주 목표")
    .first()
    .fill("실제로 사용한 결과를 남긴다");
  await page.getByLabel("전술 이름").first().fill("주간 실행 한 건");
  await page.getByLabel("1회 완료 조건").first().fill("결과 기록 한 건 저장");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
  await page.reload();
  await page.getByRole("button", { name: /나의 11주 실행/ }).click();
  await expect(page.getByLabel("실행 주수")).toHaveValue("11");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/13-eleven-week-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await expect(page.getByLabel("건강 11주 목표 선언 1")).toBeVisible();
  await page.getByRole("button", { name: "11주 착수", exact: true }).click();
  await page.getByRole("button", { name: "저장하고 11주 착수" }).click();
  await expect(page.getByLabel("주차 선택").locator("option")).toHaveCount(12);
  await expect(
    page.getByLabel("주차 선택").locator("option").last(),
  ).toHaveText("12주차 · 회고");
  await page.getByLabel("주차 선택").selectOption("11");
  await expect(page.locator(".week-switch")).toContainText("12.21 — 12.27");
  await page.getByLabel("주차 선택").selectOption("12");
  await expect(
    page.getByRole("heading", { name: "11주 동안 쌓인 실행" }),
  ).toBeVisible();
  await expect(page.locator(".season-chart > div")).toHaveCount(11);
  await expect(
    page.getByRole("button", { name: "이 11주 마무리하기" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/14-eleven-week-reflection.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

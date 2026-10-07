import { test, expect } from "@playwright/test";

test("a failed reply survives reload and retries its saved question only once", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("AI 재시도 사용자");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await expect(
    page.getByRole("button", { name: "질문 하나로 시작하기" }),
  ).toBeEnabled();
  await page.getByLabel("AI에게 보낼 메시지").fill("연결 오류 재시도 시험");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("AI 연결 실패 시험");
  await expect(
    page.getByRole("button", { name: "저장된 질문 다시 보내기" }),
  ).toBeEnabled();
  expect(
    (await page.request.get("http://127.0.0.1:4111/api/health")).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /나의 첫 12주/ }).click();
  await page.getByRole("button", { name: "AI와 비전 다듬기" }).click();
  await page.getByRole("button", { name: "저장된 질문 다시 보내기" }).click();
  await expect(page.getByRole("log")).toContainText(
    "가격 때문에 포기하고 싶지 않은 선택",
  );
  await expect(page.getByRole("log").locator("article.user")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "저장된 질문 다시 보내기" }),
  ).toHaveCount(0);
});

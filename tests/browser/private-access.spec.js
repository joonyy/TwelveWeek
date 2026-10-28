import { test, expect } from "@playwright/test";

test("private entry hides profiles until unlocked, keeps the key out of browser storage, and resumes a device session", async ({
  page,
}) => {
  const entryKey = "browser-test-private-entry-key";
  await page.route("**/api/access", (route) =>
    route.fulfill({ json: { required: true } }),
  );
  await page.route("**/api/profiles", async (route) => {
    if (route.request().headers()["x-private-access-key"] !== entryKey)
      return route.fulfill({
        status: 403,
        json: { error: "개인 공간의 접속키를 확인해주세요." },
      });
    return route.continue();
  });
  await page.route("**/api/sessions", async (route) => {
    expect(route.request().headers()["x-private-access-key"]).toBe(entryKey);
    return route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "나의 공간을 여세요." }),
  ).toBeVisible();
  await expect(page.getByLabel("새 유저 이름")).toHaveCount(0);
  await page.getByLabel("개인 접속키").fill("wrong-key");
  await page.getByRole("button", { name: "공간 열기" }).click();
  await expect(page.getByRole("alert")).toContainText("접속키를 확인");
  await page.getByLabel("개인 접속키").fill(entryKey);
  await page.getByRole("button", { name: "공간 열기" }).click();
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요." }),
  ).toBeVisible();
  await page.getByLabel("새 유저 이름").fill("개인 접속 확인");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (secret) =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret),
      entryKey,
    ),
  ).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  await expect(page.getByLabel("개인 접속키")).toHaveCount(0);
  await page.getByRole("button", { name: "유저 전환" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 공간을 여세요." }),
  ).toBeVisible();
});

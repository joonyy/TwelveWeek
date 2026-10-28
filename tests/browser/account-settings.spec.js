import { test, expect } from "@playwright/test";

test("mobile account deletion requires name, password and consent; failure keeps the account, success clears login and navigation", async ({
  page,
}) => {
  const name = `삭제 시험-${crypto.randomUUID().slice(0, 8)}`,
    password = "account-browser-password";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill(name);
  await page.getByLabel("새 유저 비밀번호").fill(password);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("twelve.token"));
  const created = await page.request.post("http://127.0.0.1:4111/api/cycles", {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: "삭제할 초안", startDate: "2026-10-19" },
  });
  expect(created.status()).toBe(201);
  const cycle = await created.json();
  await page.goto(`/#cycle=${cycle.id}&view=plan`);
  await page.getByRole("button", { name: "계정 설정", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "계정 설정" });
  await expect(
    dialog.getByRole("heading", { name: "비밀번호 재설정" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "계정 삭제 진행" }).click();
  await dialog.getByLabel("삭제 확인 이름").fill("다른 계정");
  await dialog.getByLabel("계정 삭제용 현재 비밀번호").fill("wrong");
  const remove = dialog.getByRole("button", {
    name: "계정과 모든 기록 영구 삭제",
  });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel("삭제 확인 이름").fill(name);
  await expect(remove).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await remove.click();
  await expect(dialog.getByRole("alert")).toContainText("현재 비밀번호");
  await dialog.getByRole("button", { name: "삭제 취소" }).click();
  await expect(dialog.getByLabel("삭제 확인 이름")).toHaveCount(0);
  await dialog.getByRole("button", { name: "계정 삭제 진행" }).click();
  await expect(dialog.getByLabel("계정 삭제용 현재 비밀번호")).toHaveValue("");
  await dialog.getByLabel("삭제 확인 이름").fill(name);
  await dialog.getByLabel("계정 삭제용 현재 비밀번호").fill(password);
  await dialog.getByRole("checkbox").check();
  await page.route("**/api/me", async (route) => {
    if (route.request().method() === "DELETE")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "삭제 실패 시험" }),
      });
    else await route.continue();
  });
  await remove.click();
  await expect(dialog.getByRole("alert")).toHaveText("삭제 실패 시험");
  expect(
    (
      await page.request.get(`http://127.0.0.1:4111/api/cycles/${cycle.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(200);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.unroute("**/api/me");
  await remove.click();
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(name) }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("twelve.token")),
  ).toBeNull();
  expect(new URL(page.url()).hash).toBe("");
  expect(
    (
      await page.request.get(`http://127.0.0.1:4111/api/cycles/${cycle.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요.", exact: true }),
  ).toBeVisible();
});

import { test, expect } from "@playwright/test";

test("profile selection asks for a password, handles failure, and restores a session without persisting the password", async ({
  page,
}) => {
  const name = `비밀번호 로그인-${crypto.randomUUID().slice(0, 8)}`;
  const password = "browser-password-test";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요.", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("개인 접속키")).toHaveCount(0);
  await page.getByLabel("새 유저 이름").fill(name);
  await page.getByLabel("새 유저 비밀번호").fill(password);
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeFocused();
  await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "비밀번호를 확인",
  );
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (p) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(p),
      password,
    ),
  ).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveCount(0);
});

test("password change validates confirmation and current password, and the new password works after logout", async ({
  page,
}) => {
  const name = `비밀번호 변경-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill(name);
  await page.getByLabel("새 유저 비밀번호").fill("test-password");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await page
    .getByLabel("현재 비밀번호", { exact: true })
    .fill("wrong-password");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("new-password");
  await page
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("different-password");
  await page.getByRole("button", { name: "비밀번호 저장" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "일치하지 않아요",
  );
  await page
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("new-password");
  await page.getByRole("button", { name: "비밀번호 저장" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "현재 비밀번호",
  );
  await page.getByLabel("현재 비밀번호", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "비밀번호 저장" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel("비밀번호", { exact: true }).fill("new-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
});

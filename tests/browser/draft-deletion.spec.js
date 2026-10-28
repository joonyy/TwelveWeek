import { test, expect } from "@playwright/test";

test("draft cards offer deletion with period confirmation, cancel and stale-version protection on mobile", async ({
  page,
}) => {
  const name = `초안 삭제-${crypto.randomUUID().slice(0, 8)}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill(name);
  await page.getByLabel("새 유저 비밀번호").fill("test-password");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await expect(
    page.getByRole("button", { name: "첫 12주 작성하기" }),
  ).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("twelve.token")),
    headers = { Authorization: `Bearer ${token}` };
  const first = await page.request.post("http://127.0.0.1:4111/api/cycles", {
    headers,
    data: { title: "잘못 만든 초안", startDate: "2026-10-05", weekCount: 12 },
  });
  expect(first.status()).toBe(201);
  const draft = await first.json();
  const kept = await page.request.post("http://127.0.0.1:4111/api/cycles", {
    headers,
    data: { title: "남길 초안", startDate: "2026-10-19", weekCount: 10 },
  });
  expect(kept.status()).toBe(201);
  await page.reload();
  const card = page.getByRole("article", {
    name: "잘못 만든 초안 · 2026-10-05",
    exact: true,
  });
  await card.getByRole("button", { name: "초안 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "작성 중인 초안 삭제" });
  await expect(dialog).toContainText("2026-10-05 — 2026-12-27 · 12주");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "초안 삭제", exact: true }).click();
  const changed = await page.request.put(
    `http://127.0.0.1:4111/api/cycles/${draft.id}`,
    {
      headers,
      data: {
        title: "이름이 바뀐 초안",
        startDate: draft.start_date,
        plan: draft.plan,
        version: draft.version,
        weekCount: draft.week_count,
      },
    },
  );
  expect(changed.status()).toBe(200);
  await dialog
    .getByRole("button", { name: "이 초안 삭제", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("다른 화면");
  await dialog.getByRole("button", { name: "목록 새로고침" }).click();
  await expect(dialog).toHaveCount(0);
  const updated = page.getByRole("article", {
    name: "이름이 바뀐 초안 · 2026-10-05",
    exact: true,
  });
  await updated.getByRole("button", { name: "초안 삭제", exact: true }).click();
  await dialog
    .getByRole("button", { name: "이 초안 삭제", exact: true })
    .click();
  await expect(updated).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "남길 초안 · 2026-10-19", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(`http://127.0.0.1:4111/api/cycles/${draft.id}`, {
        headers,
      })
    ).status(),
  ).toBe(404);
  await page.reload();
  await expect(
    page.getByRole("article", { name: "남길 초안 · 2026-10-19", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

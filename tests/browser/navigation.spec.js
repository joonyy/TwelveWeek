import { test, expect } from "@playwright/test";
import { emptyPlan } from "../../shared/domain.js";

async function fixture(page, request, name) {
  const base = "http://127.0.0.1:4111/api";
  const profile = await (
    await request.post(`${base}/profiles`, {
      data: {
        password: "test-password",
        name: `${name}-${crypto.randomUUID().slice(0, 8)}`,
      },
    })
  ).json();
  const session = await (
    await request.post(`${base}/sessions`, {
      data: { password: "test-password", profileId: profile.id },
    })
  ).json();
  const headers = { Authorization: `Bearer ${session.token}` };
  const plan = emptyPlan(2);
  for (const [i, goal] of plan.goals.slice(0, 2).entries()) {
    goal.title = `복원할 목표 ${i + 1}`;
    goal.success = `확인할 결과 ${i + 1}`;
    Object.assign(goal.tactics[0], {
      title: `실행 ${i + 1}`,
      condition: `완료 기준 ${i + 1}`,
      weeks: [1, 2],
      count: 1,
    });
  }
  const cycle = await (
    await request.post(`${base}/cycles`, {
      headers,
      data: { title: name, startDate: "2026-10-05", weekCount: 2, plan },
    })
  ).json();
  expect(
    (
      await request.post(`${base}/cycles/${cycle.id}/start`, {
        headers,
        data: { version: cycle.version },
      })
    ).ok(),
  ).toBe(true);
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.goto("/");
  await page.evaluate(
    (value) => localStorage.setItem("twelve.token", value),
    session.token,
  );
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/day=2026-10-07/);
  return { cycle, profile, headers, base };
}

test("refresh resumes execution week, date, tabs and goal planning without writing data", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { cycle } = await fixture(page, request, "새로고침 위치 복원");
  await page.getByLabel("주차 선택").selectOption("2");
  await page.locator(".day-strip button").nth(4).click();
  await expect(
    page.getByRole("heading", { name: "10.16의 실행", exact: true }),
  ).toBeVisible();
  const writes = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "DELETE"].includes(r.method())) writes.push(r.url());
  });
  await page.reload();
  await expect(page.getByLabel("주차 선택")).toHaveValue("2");
  await expect(
    page.getByRole("heading", { name: "10.16의 실행", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`cycle=${cycle.id}`));
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "이번 주 일정 캘린더" }),
  ).toBeVisible();
  await expect(page.getByLabel("주차 선택")).toHaveValue("2");
  await page
    .getByRole("button", { name: "이번 주 계획표", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "2주차 계획표", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "주간 평가 · 30분", exact: true })
    .click();
  await page.reload();
  await expect(page.getByLabel("실행과 결과에서 발견한 것")).toBeVisible();
  await page
    .getByRole("button", { name: "비전과 2주 계획", exact: true })
    .click();
  await page.getByRole("tab", { name: /2주 계획$/ }).click();
  await page
    .getByRole("navigation", { name: "목표별 계획 선택" })
    .getByRole("button", { name: /복원할 목표 2/ })
    .click();
  await page.reload();
  await expect(page.getByLabel("성공 기준", { exact: true })).toHaveValue(
    "확인할 결과 2",
  );
  await page
    .getByRole("group", { name: "계획 보기 방식" })
    .getByRole("button", { name: "주차별", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "계획 주차 선택" })
    .getByRole("button", { name: /^2주차/ })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "2주차의 계획", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /삶의 태도$/ }).click();
  await page.reload();
  await expect(
    page.getByRole("group", { name: "헌신의 7영역 바퀴" }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "나의 12주", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "나의 12주", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(errors).toEqual([]);
});

test("invalid, inaccessible and expired navigation is safe and temporary failures retain the address", async ({
  page,
  request,
}) => {
  const { cycle } = await fixture(page, request, "화면 복원 경계 검증");
  await page.goto("about:blank");
  await page.goto(
    `/#cycle=${cycle.id}&view=week&week=13&mode=invalid&day=2026-02-30&tab=99`,
  );
  await page.reload();
  await expect(page.getByLabel("주차 선택")).toHaveValue("3");
  await page.getByLabel("주차 선택").selectOption("1");
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  const resumeUrl = page.url();
  await page.route(`**/api/cycles/${cycle.id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "연결 실패 시험" }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("연결 실패 시험");
  expect(page.url()).toBe(resumeUrl);
  await page.unroute(`**/api/cycles/${cycle.id}`);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "이번 주 일정 캘린더" }),
  ).toBeVisible();
  // Same UUID shape, but no owned cycle: fall back to the list and keep the login.
  await page.goto("about:blank");
  await page.goto(`/#cycle=${crypto.randomUUID()}&view=week`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "나의 12주", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: /화면 복원 경계 검증/ }).click();
  await page.getByRole("button", { name: "유저 전환", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요.", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.goto("about:blank");
  await page.goto(`/#cycle=${cycle.id}&view=week`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요.", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});

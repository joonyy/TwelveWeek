import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { emptyPlan } from "../../shared/domain.js";

test("weekly preview groups existing tactics, keeps scoring untouched and reflects unsaved edits", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("주차별 계획 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByLabel("이번 12주의 이름").fill("주차별로 보는 10주");
  await page.getByLabel("시작 월요일").fill("2026-10-19");
  await page.getByLabel("실행 주수").selectOption("10");
  const creation = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/cycles$/.test(new URL(r.url()).pathname),
  );
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  const cycle = await (await creation).json();
  const sessionToken = await page.evaluate(() =>
    localStorage.getItem("twelve.token"),
  );
  const headers = { Authorization: `Bearer ${sessionToken}` };
  const url = `http://127.0.0.1:4111/api/cycles/${cycle.id}`;
  const tactic = (title, kind, count, weeks) => ({
    id: randomUUID(),
    title,
    condition: `${title}의 확인 가능한 결과를 남긴다.`,
    kind,
    count,
    weeks,
  });
  const plan = structuredClone(cycle.plan);
  plan.goals[0].title = "AI 큰 장 하나를 이해하기";
  plan.goals[0].tactics = [
    tactic("큰 장을 나누어 학습하고 초안 남기기", "weekly", 2, [1, 2]),
  ];
  plan.goals[1].title = "일상 운동과 기록 측정";
  plan.goals[1].tactics = [
    tactic("매일 기록 확인", "daily", 1, [1, 2]),
    tactic("자동화 최종 적용", "once", 9, [8]),
    tactic("주차를 정할 활동", "weekly", 1, []),
  ];
  const seededResponse = await page.request.put(url, {
    headers,
    data: {
      title: cycle.title,
      startDate: cycle.start_date,
      weekCount: cycle.week_count,
      version: cycle.version,
      plan,
    },
  });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json();
  await page.reload();

  await page.getByRole("tab", { name: "10주 계획" }).click();
  const view = page.getByRole("group", { name: "계획 보기 방식" });
  await view.getByRole("button", { name: "주차별", exact: true }).click();
  const preview = page.getByRole("region", { name: "주차별 계획 미리보기" });
  const weeks = page.getByRole("navigation", { name: "계획 주차 선택" });
  await expect(weeks.getByRole("button")).toHaveCount(10);
  await expect(weeks.getByRole("button").first()).toContainText(
    "10.19 — 10.25",
  );
  await expect(
    preview.getByRole("heading", { name: "1주차의 계획" }),
  ).toBeVisible();
  await expect(preview.locator(".weekly-plan-goal")).toHaveCount(2);
  await expect(preview.locator(".weekly-plan-summary")).toHaveText(
    "목표2개전술2개실행9회",
  );
  await expect(preview.getByText("매일 1회 · 총 7회")).toBeVisible();
  await expect(preview.getByText("주 2회 이상", { exact: true })).toBeVisible();
  await expect(
    preview.getByText("자동화 최종 적용", { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("complementary", { name: "실행 주차가 없는 전술" }),
  ).toContainText("1개");
  await preview.locator("summary").first().click();
  await expect(
    preview.getByText(
      "큰 장을 나누어 학습하고 초안 남기기의 확인 가능한 결과를 남긴다.",
    ),
  ).toBeVisible();
  await preview.screenshot({ path: "test-results/30-weekly-plan-desktop.png" });
  await weeks.getByRole("button", { name: /^8주차/ }).click();
  await expect(preview.locator(".weekly-plan-summary")).toHaveText(
    "목표1개전술1개실행1회",
  );
  await expect(
    preview.getByText("자동화 최종 적용", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByText("이번 주 최소 1회", { exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".weekly-plan-heading")).toContainText(
    "12.7 — 12.13",
  );
  await weeks.getByRole("button", { name: /^3주차/ }).click();
  await expect(preview.getByText(/이 주에 예정된 전술이 없어요/)).toBeVisible();
  const unchanged = await (await page.request.get(url, { headers })).json();
  expect(unchanged.version).toBe(seeded.version);
  expect(unchanged.status).toBe("draft");
  expect(unchanged.plan).toEqual(plan);
  await weeks.getByRole("button", { name: /^1주차/ }).click();
  await preview.getByRole("button", { name: "목표 1 계획 수정" }).click();
  await expect(page.locator(".goal-plan-title")).toHaveText(
    "AI 큰 장 하나를 이해하기",
  );
  await page.getByLabel("주당 횟수").fill("3");
  await view.getByRole("button", { name: "주차별", exact: true }).click();
  await expect(preview.locator(".weekly-plan-summary")).toHaveText(
    "목표2개전술2개실행10회",
  );
  await expect(preview.getByText("주 3회 이상", { exact: true })).toBeVisible();
  const saving = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === `/api/cycles/${cycle.id}`,
  );
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const saved = await (await saving).json();
  expect(saved.plan.goals.flatMap((g) => g.tactics.map((t) => t.id))).toEqual(
    plan.goals.flatMap((g) => g.tactics.map((t) => t.id)),
  );
  await page.reload();

  await page.getByRole("tab", { name: "10주 계획" }).click();
  await view.getByRole("button", { name: "주차별", exact: true }).click();
  await expect(preview.getByText("주 3회 이상", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await weeks.getByRole("button", { name: /^8주차/ }).click();
  expect(await weeks.evaluate((el) => el.clientHeight)).toBeLessThan(110);
  expect(await weeks.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await preview.screenshot({ path: "test-results/31-weekly-plan-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("실행 주수").selectOption("3");
  await expect(weeks.getByRole("button")).toHaveCount(3);
  await expect(
    preview.getByRole("heading", { name: "3주차의 계획" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

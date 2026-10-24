import { test, expect } from "@playwright/test";

test("review Apple conflicts, link a work block and create a study event without changing execution counts", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00+09:00"));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("Apple 일정 병합 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByLabel("이번 12주의 이름").fill("캘린더와 비교하는 2주");
  await page.getByLabel("시작 월요일").fill("2026-10-05");
  await page.getByLabel("실행 주수").selectOption("2");
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page.getByRole("tab", { name: "2주 목표" }).click();
  await page.getByLabel("2주 목표 1", { exact: true }).fill("학습 결과 만들기");
  await page.getByRole("button", { name: "2주 계획 세우기" }).click();
  await page.getByLabel("전술 이름").fill("큰 장 학습하기");
  await page.getByLabel("1회 완료 조건").fill("내 말로 설명하고 초안 저장");
  await page.getByLabel("주당 횟수").fill("2");
  await page
    .getByRole("group", { name: "계획 보기 방식" })
    .getByRole("button", { name: "주차별", exact: true })
    .click();
  await page
    .getByRole("button", { name: "저장하고 Apple Calendar와 비교" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Apple Calendar와 주간 계획 비교",
  });
  await dialog.getByLabel("Apple 계정 이메일").fill("test@example.com");
  await dialog.getByLabel("앱 전용 암호").fill("abcd-efgh-ijkl-mnop");
  await dialog
    .getByRole("button", { name: "iCloud 캘린더 연결", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "기존 일정 불러오기", exact: true })
    .click();
  await expect(dialog.getByText(/기존 일정 1개/)).toBeVisible();
  const first = dialog.locator(".calendar-placement").nth(0),
    second = dialog.locator(".calendar-placement").nth(1);
  await first.getByLabel("반영 방식").selectOption("create");
  await first.getByLabel("실행 날짜").selectOption("2026-10-06");
  await first.getByLabel("시작 시각").fill("10:00");
  await expect(first).toContainText("Apple · OVS 근무");
  await dialog
    .getByRole("button", { name: "적용 전 검토", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("겹치는 일정을");
  await first.getByLabel("반영 방식").selectOption("link");
  await first.getByLabel("연결할 기존 일정").selectOption("work-event");
  await expect(first.locator(".calendar-conflict-review")).toHaveCount(0);
  await second.getByLabel("반영 방식").selectOption("create");
  await second.getByLabel("실행 날짜").selectOption("2026-10-07");
  await second.getByLabel("시작 시각").fill("18:00");
  await expect(dialog.locator(".calendar-event")).toHaveCount(2);
  await dialog
    .getByRole("button", { name: "적용 전 검토", exact: true })
    .click();
  const review = dialog.getByRole("region", { name: "캘린더 적용 검토" });
  await expect(review).toContainText("새 일정 1개 → 학습 · 기존 일정 연결 1개");
  await review.scrollIntoViewIfNeeded();
  await dialog.screenshot({
    path: "test-results/32-calendar-merge-review.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await review.scrollIntoViewIfNeeded();
  await dialog.screenshot({
    path: "test-results/33-calendar-merge-mobile.png",
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const applying = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/previews\/[^/]+\/apply$/.test(new URL(r.url()).pathname),
  );
  await review
    .getByRole("button", {
      name: "검토한 내용 Apple Calendar에 적용",
      exact: true,
    })
    .click();
  const result = await (await applying).json();
  expect(result.ok).toBe(true);
  expect(result.cycle.status).toBe("draft");
  expect(result.cycle.plan.goals[0].tactics[0].count).toBe(2);
  expect(result.cycle.plan.weeklySchedules[0].placements).toHaveLength(2);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".toast[role='status']")).toHaveText(
    "새 일정 1개와 기존 일정 연결 1개를 반영했어요.",
  );
  await expect(page.locator(".info-note[role='status']")).toHaveCount(0);
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await page.getByRole("button", { name: "2주 착수", exact: true }).click();
  const starting = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      /\/weeks\/1$/.test(new URL(r.url()).pathname),
  );
  await page
    .getByRole("button", { name: "저장하고 2주 착수", exact: true })
    .click();
  const week = await (await starting).json();
  expect(week.state.occurrences).toHaveLength(2);
  expect(
    week.state.occurrences.map((o) => [o.date, o.time, o.completed]),
  ).toEqual([
    ["2026-10-06", "10:00", false],
    ["2026-10-07", "18:00", false],
  ]);
  expect(errors).toEqual([]);
});

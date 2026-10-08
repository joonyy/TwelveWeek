import { test, expect } from "@playwright/test";

test("write goals beside three-year visions, select multiple connections and preserve identity through edits and reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("3년 비전 연결 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByLabel("이번 12주의 이름").fill("비전과 이어지는 11주");
  await page.getByLabel("시작 월요일").fill("2026-10-12");
  await page.getByLabel("실행 주수").selectOption("11");
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page
    .getByLabel("개인 생활의 비전 1", { exact: true })
    .fill("회복을 지키는 생활");
  await page.getByLabel("개인 생활의 비전 1", { exact: true }).press("Enter");
  await page
    .getByLabel("개인 생활의 비전 2", { exact: true })
    .fill("생활비 이후에도 저축하는 생활");
  await page
    .getByLabel("커리어의 비전 1", { exact: true })
    .fill("직접 쓰는 서비스를 운영한다");
  await page.getByRole("tab", { name: "11주 목표" }).click();
  const reference = page.getByRole("complementary", {
    name: "목표 작성용 3년 비전",
  });
  await expect(
    reference.getByText("생활비 이후에도 저축하는 생활", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("11주 목표 1", { exact: true })
    .fill("TwelveWeek 실제 사용 시험");
  await page
    .getByLabel("11주 목표 2", { exact: true })
    .fill("저축 300만원에 도전");
  const first = page.locator(".goal-list-row").nth(0);
  const second = page.locator(".goal-list-row").nth(1);
  const selectFirst = first.getByLabel("목표 1의 3년 비전 연결 선택");
  await selectFirst.click();
  await first
    .getByRole("checkbox", { name: "회복을 지키는 생활", exact: true })
    .check();
  await first
    .getByRole("checkbox", { name: "직접 쓰는 서비스를 운영한다", exact: true })
    .check();
  await selectFirst.click();
  await second.getByLabel("목표 2의 3년 비전 연결 선택").click();
  await second
    .getByRole("checkbox", {
      name: "생활비 이후에도 저축하는 생활",
      exact: true,
    })
    .check();
  await second.getByLabel("목표 2의 3년 비전 연결 선택").click();
  await expect(first.locator(".vision-link-chip")).toHaveCount(2);
  await expect(second.locator(".vision-link-chip")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/25-vision-goals-desktop.png",
    fullPage: true,
  });

  const save = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        /\/api\/cycles\/[^/]+$/.test(new URL(r.url()).pathname),
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const saved = await response;
    expect(saved.ok()).toBe(true);
    await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
    return saved.json();
  };
  const before = await save();
  await reference.getByRole("button", { name: "3년 비전 수정" }).click();
  await page
    .getByLabel("커리어의 비전 1", { exact: true })
    .fill("사용자와 함께 내 서비스를 발전시킨다");
  await page.getByLabel("개인 생활의 비전 1", { exact: true }).press("Enter");
  await page
    .getByLabel("개인 생활의 비전 2", { exact: true })
    .fill("관계에 시간을 쓰는 생활");
  await page
    .getByRole("group", { name: "개인 생활의 비전 입력 방식" })
    .getByRole("button", { name: "자유 서술" })
    .click();
  // Reorder free-text paragraphs while retaining the selected item's identity.
  await page
    .getByRole("textbox", { name: "개인 생활의 비전", exact: true })
    .fill(
      "생활비 이후에도 저축하는 생활\n회복을 지키는 생활\n관계에 시간을 쓰는 생활",
    );
  await page
    .getByRole("group", { name: "개인 생활의 비전 입력 방식" })
    .getByRole("button", { name: "목록", exact: true })
    .click();
  await page.getByRole("tab", { name: "11주 목표" }).click();
  await expect(first.locator(".goal-vision-summary")).toContainText(
    "사용자와 함께 내 서비스를 발전시킨다",
  );
  await expect(second.locator(".goal-vision-summary")).toContainText(
    "생활비 이후에도 저축하는 생활",
  );
  const after = await save();
  expect(after.plan.goals.map((goal) => goal.id)).toEqual(
    before.plan.goals.map((goal) => goal.id),
  );
  expect(after.plan.goals.map((goal) => goal.tactics)).toEqual(
    before.plan.goals.map((goal) => goal.tactics),
  );
  expect(
    after.plan.goals.map((goal) => goal.visionLinks.map((link) => link.itemId)),
  ).toEqual(
    before.plan.goals.map((goal) =>
      goal.visionLinks.map((link) => link.itemId),
    ),
  );
  await page.getByRole("button", { name: "11주 계획 세우기" }).click();
  await expect(page.locator(".goal-panel .goal-vision-summary")).toContainText(
    "사용자와 함께 내 서비스를 발전시킨다",
  );
  await page
    .getByRole("navigation", { name: "목표별 계획 선택" })
    .getByRole("button", { name: /저축 300만원/ })
    .click();
  await expect(page.locator(".goal-panel .goal-vision-summary")).toContainText(
    "생활비 이후에도 저축하는 생활",
  );

  await page.getByRole("tab", { name: /비전$/ }).click();
  await page
    .getByRole("button", { name: "커리어의 비전 1 삭제", exact: true })
    .click();
  await page
    .getByLabel("커리어의 비전 1", { exact: true })
    .fill("새로 추가한 별개의 비전");
  await page.getByRole("tab", { name: "11주 목표" }).click();
  await expect(first.locator(".vision-link-chip.missing")).toContainText(
    "사용자와 함께 내 서비스를 발전시킨다",
  );
  await save();
  await page.reload();
  await page.getByRole("button", { name: /비전과 이어지는 11주/ }).click();
  await page.getByRole("tab", { name: "11주 목표" }).click();
  await selectFirst.click();
  await expect(
    first.getByRole("checkbox", { name: "회복을 지키는 생활", exact: true }),
  ).toBeChecked();
  await expect(
    first.getByRole("checkbox", {
      name: "새로 추가한 별개의 비전",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(first.locator(".vision-link-chip.missing")).toContainText(
    "연결 검토",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/26-vision-goals-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await first
    .getByRole("button", {
      name: "사용자와 함께 내 서비스를 발전시킨다 연결 해제",
      exact: true,
    })
    .click();
  await first
    .getByRole("checkbox", { name: "새로 추가한 별개의 비전", exact: true })
    .check();
  const final = await save();
  expect(final.plan.goals[0].visionLinks).toHaveLength(2);
  expect(
    final.plan.goals[0].visionLinks.some(
      (link) => link.text === "사용자와 함께 내 서비스를 발전시킨다",
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

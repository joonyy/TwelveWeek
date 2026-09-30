import { test, expect } from "@playwright/test";
test("list modes, three starter goals, calendar interaction and commitment wheel persist", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("새 유저 이름").fill("편집 화면 검증");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await expect(
    page
      .getByRole("group", { name: "장기 비전 입력 방식" })
      .getByRole("button", { name: "목록", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("textbox", { name: "장기 비전 1", exact: true })
    .fill("내 시간을 스스로 선택하는 삶");
  await page
    .getByRole("textbox", { name: "장기 비전 1", exact: true })
    .press("Enter");
  await page
    .getByRole("textbox", { name: "장기 비전 2", exact: true })
    .fill("건강한 관계");
  await page
    .getByRole("group", { name: "장기 비전 입력 방식" })
    .getByRole("button", { name: "자유 서술" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "장기 비전", exact: true }),
  ).toHaveValue("내 시간을 스스로 선택하는 삶\n건강한 관계");
  await page
    .getByRole("group", { name: "장기 비전 입력 방식" })
    .getByRole("button", { name: "목록", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "장기 비전 2", exact: true }),
  ).toHaveValue("건강한 관계");
  await page
    .getByRole("textbox", { name: "개인 생활의 비전 1", exact: true })
    .fill("회복이 있는 생활");
  await page
    .getByRole("textbox", { name: "커리어의 비전 1", exact: true })
    .fill("내 서비스를 운영한다");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/06-vision-lists.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "목표와 12주 계획" }).click();
  await expect(page.locator(".goal-panel")).toHaveCount(3);
  await expect(page.getByLabel("전술 이름")).toHaveCount(3);
  await page.getByRole("tab", { name: "모범 주간" }).click();
  await page
    .getByRole("button", { name: "월요일 09:00 블록 추가", exact: true })
    .click();
  await page.getByLabel("할 활동", { exact: true }).fill("전략 3시간");
  await page.getByRole("button", { name: "블록 적용" }).click();
  await page
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("할 활동", { exact: true }).fill("버퍼 블록");
  await page.getByLabel("블록 시작 시각").fill("10:00");
  await page.getByLabel("블록 종류").selectOption("buffer");
  await page.getByLabel("블록 길이(분)").fill("60");
  await page.getByRole("button", { name: "블록 적용" }).click();
  await expect(page.locator(".calendar-event")).toHaveCount(2);
  const event = page.getByRole("button", {
    name: "전략 3시간 · 월요일 09:00 · 180분",
    exact: true,
  });
  await event.dragTo(
    page.getByRole("button", { name: "화요일 08:00 블록 추가", exact: true }),
    { targetPosition: { x: 15, y: 2 } },
  );
  await expect(
    page.getByRole("button", {
      name: "전략 3시간 · 화요일 08:00 · 180분",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "시간 블록 추가", exact: true })
    .click();
  await page.getByLabel("할 활동", { exact: true }).fill("야간 회복");
  await page.getByLabel("블록 요일").selectOption("6");
  await page.getByLabel("블록 시작 시각").fill("03:00");
  await page.getByLabel("블록 종류").selectOption("breakout");
  await page.getByRole("button", { name: "블록 적용" }).click();
  await expect(
    page.getByRole("button", {
      name: "야간 회복 · 일요일 03:00 · 180분",
      exact: true,
    }),
  ).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/07-model-calendar.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await expect(page.locator(".responsibility-guides article")).toHaveCount(4);
  await expect(
    page.getByText("자신을 가엾게 여기지 말라.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "개인 생활에서의 책임 실천 1", exact: true })
    .fill("상황과 내가 선택할 행동을 구분하기");
  await page
    .getByRole("textbox", { name: "일에서의 책임 실천 1", exact: true })
    .fill("내가 맡은 약속의 진행 상황을 공유하기");
  await page
    .locator(".responsibility-editor")
    .screenshot({ path: "test-results/08-responsibility.png" });
  await page
    .getByRole("button", { name: "비즈니스 영역 선택", exact: true })
    .click();
  await page
    .getByLabel("비즈니스 12주 목표 선언 1")
    .fill("내 서비스를 사용할 수 있게 하기");
  await page
    .getByLabel("비즈니스 핵심 활동 1", { exact: true })
    .fill("매주 한 기능을 완성한다");
  await page.getByLabel("비즈니스 헌신 비용 1").fill("주 3시간 집중");
  await page
    .getByRole("button", { name: "비즈니스 핵심 활동 1 비용 감수" })
    .click();
  await expect(
    page.getByRole("button", { name: "비즈니스 핵심 활동 1 비용 감수" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator(".commitment-practice")
    .screenshot({ path: "test-results/09-commitment-wheel.png" });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
  await page.reload();
  await page.getByRole("button", { name: /나의 첫 12주/ }).click();
  await expect(
    page.getByRole("textbox", { name: "장기 비전 2", exact: true }),
  ).toHaveValue("건강한 관계");
  await expect(
    page.getByRole("textbox", { name: "개인 생활의 비전 1", exact: true }),
  ).toHaveValue("회복이 있는 생활");
  await page.getByRole("tab", { name: "모범 주간" }).click();
  await expect(
    page.getByRole("button", {
      name: "전략 3시간 · 화요일 08:00 · 180분",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await expect(
    page.getByRole("textbox", { name: "일에서의 책임 실천 1", exact: true }),
  ).toHaveValue("내가 맡은 약속의 진행 상황을 공유하기");
  await page
    .getByRole("button", { name: "비즈니스 영역 선택", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "비즈니스 핵심 활동 1 비용 감수" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".commitment-practice")
    .screenshot({ path: "test-results/10-wheel-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "모범 주간" }).click();
  await page
    .locator(".week-calendar")
    .screenshot({ path: "test-results/11-calendar-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

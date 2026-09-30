import { test, expect } from "@playwright/test";
test("profile → guided plan → schedule → binary execution → weekly review → reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요." }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/01-entry-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("새 유저 이름").fill("첫 사용자");
  await page.getByRole("button", { name: "나의 공간 만들기" }).click();
  await page.getByRole("button", { name: "첫 12주 작성하기" }).click();
  await page.getByRole("button", { name: "비전부터 작성하기" }).click();
  await page.getByRole("tab", { name: "비전", exact: false }).first().waitFor();
  await page.getByLabel("시작 월요일").fill("");
  await expect(page.getByText("시작일을 선택해주세요.")).toBeVisible();
  await page.getByLabel("시작 월요일").fill("2026-10-05");
  await page
    .getByRole("textbox", { name: "장기 비전 1", exact: true })
    .fill("자율성과 회복을 지키며 내 소유의 결과물을 쌓는다.");
  await page
    .getByRole("textbox", { name: "개인 생활의 비전 1", exact: true })
    .fill("규칙적인 회복과 꾸준한 운동");
  await page
    .getByRole("textbox", { name: "커리어의 비전 1", exact: true })
    .fill("내가 쓰는 서비스를 다른 사람도 쓰도록 발전시킨다.");
  await page.getByRole("tab", { name: "목표와 12주 계획" }).click();
  await expect(page.locator(".goal-panel")).toHaveCount(3);
  await page.getByLabel("03. 12주 목표").first().fill("지속 가능한 러닝 습관");
  await page
    .getByLabel("성공 기준", { exact: true })
    .first()
    .fill("매주 실행 기록을 남긴다.");

  await page.getByLabel("전술 이름").first().fill("주 3회 5km 달리기");
  await page.getByLabel("1회 완료 조건").first().fill("5km를 완주한다.");
  await page.getByLabel("주당 횟수").first().fill("3");
  await page
    .getByLabel("선행지표 · 내가 실행할 행동")
    .first()
    .fill("러닝 횟수");
  await page.getByLabel("후행지표 · 나타난 결과").first().fill("평균 페이스");

  await page.getByLabel("예상되는 어려움").first().fill("교대근무 후 피로");
  await page
    .getByLabel("그때 취할 대응")
    .first()
    .fill("회복 후 같은 주 안에서 날짜 조정");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/02-plan-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "모범 주간" }).click();
  await page
    .getByRole("button", { name: "월요일 09:00 블록 추가", exact: true })
    .click();
  await page.getByLabel("할 활동", { exact: true }).fill("나를 위한 집중 시간");
  await page.getByRole("button", { name: "블록 적용" }).click();
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await page
    .getByRole("textbox", { name: "개인 생활에서의 책임 실천 1", exact: true })
    .fill("실행할 수 있는 규모로 선택하기");
  await expect(
    page.getByRole("group", { name: "헌신의 7영역 바퀴" }).getByRole("button"),
  ).toHaveCount(7);
  await page.getByLabel("건강 12주 목표 선언 1").fill("회복을 희생하지 않기");
  await page
    .getByLabel("건강 핵심 활동 1", { exact: true })
    .fill("수면 시간 확보하기");
  await page.getByLabel("건강 헌신 비용 1").fill("늦은 시간의 다른 활동 포기");
  await page
    .getByRole("button", { name: "건강 핵심 활동 1 비용 감수" })
    .click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
  await page.getByRole("button", { name: "12주 착수", exact: true }).click();
  await page.getByRole("button", { name: "저장하고 12주 착수" }).click();
  await expect(
    page.getByRole("heading", { name: "이번 주의 약속을 오늘의 실행으로." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "주간 일정", exact: true }).click();
  await page.getByRole("button", { name: /주 3회 5km 달리기.*1회차/ }).click();
  await page.getByLabel("평가 날짜").fill("2026-10-07");
  await page.getByLabel("시작 시각").fill("09:00");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByText("나를 위한 집중 시간")).toBeAttached();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Apple 캘린더로 내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("12주-1주차.ics");
  await page.getByRole("button", { name: "일간 실행 · 10분" }).click();
  await page
    .getByRole("button", { name: "주 3회 5km 달리기 완료", exact: true })
    .click();
  await expect(page.locator(".main-stat strong")).toHaveText("33.3%");
  await expect(page.locator(".day-strip .selected")).toContainText("100%");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/03-execution-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "주간 평가 · 30분" }).click();
  await page.getByLabel("선행지표 관찰").fill("1회");
  await page.getByLabel("후행지표 관찰").fill("관찰 중");
  await page
    .getByLabel("실행과 결과에서 발견한 것")
    .fill("회복 후 오전에 실행이 편했다.");
  await page.getByRole("button", { name: "주간 평가 저장" }).click();
  await page.reload();
  await page.getByRole("button", { name: /나의 첫 12주/ }).click();
  await page.getByRole("button", { name: "주간 평가 · 30분" }).click();
  await expect(page.getByLabel("선행지표 관찰")).toHaveValue("1회");
  await page.getByRole("button", { name: "비전과 12주 계획" }).click();
  await page.getByRole("tab", { name: "삶의 태도" }).click();
  await expect(
    page.getByRole("textbox", {
      name: "개인 생활에서의 책임 실천 1",
      exact: true,
    }),
  ).toHaveValue("실행할 수 있는 규모로 선택하기");
  await page.getByRole("tab", { name: "비전", exact: false }).first().click();
  await page
    .getByRole("textbox", { name: "장기 비전 1", exact: true })
    .fill("저장하지 않은 내용");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "실행과 평가", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "장기 비전 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("계획을 저장했어요.");
  await page.getByRole("button", { name: "실행과 평가", exact: true }).click();
  await page.getByLabel("주차 선택").selectOption("13");
  await page
    .getByLabel("이번 12주에 실제로 달라진 것은?")
    .fill("실행 기록을 남길 수 있는 구조가 생겼다.");
  await page.getByRole("button", { name: "12주 회고 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("12주 회고를 저장했어요.");
  await page.getByLabel("주차 선택").selectOption("1");
  await page.getByLabel("주차 선택").selectOption("13");
  await expect(page.getByLabel("이번 12주에 실제로 달라진 것은?")).toHaveValue(
    "실행 기록을 남길 수 있는 구조가 생겼다.",
  );
  await page.getByLabel("주차 선택").selectOption("1");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "일간 실행 · 10분" }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/04-execution-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("mobile profile entry does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "유저를 선택하세요." }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/05-entry-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
